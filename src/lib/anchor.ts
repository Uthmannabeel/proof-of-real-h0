import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { getStore } from "./store";

/**
 * Flare anchoring — publishes the registry hash-chain head to the
 * ProofOfRealAnchor contract on Coston2, making the whole ledger history
 * publicly tamper-provable. The server wallet (registrar) signs anchor txs;
 * reads need no key.
 */

const ANCHOR_ABI = [
  "function anchor(bytes32 chainHead, uint64 recordCount) external",
  "function anchorCount() view returns (uint256)",
  "function latestAnchor() view returns (tuple(bytes32 chainHead, uint64 recordCount, uint64 anchoredAt))",
  "function isAnchored(bytes32 chainHead) view returns (bool anchored, uint64 anchoredAt, uint64 recordCount)",
  "function registrar() view returns (address)",
];

const DEFAULT_RPC = "https://coston2-api.flare.network/ext/C/rpc";
const COSTON2_CHAIN_ID = 114;
const EXPLORER_BASE = "https://coston2-explorer.flare.network";
const MAX_LEDGER_SCAN = 1000;
const RPC_TIMEOUT_MS = 15_000;

/** Static network config: skips chain auto-detection, which retries forever when the RPC is unreachable. */
function newProvider(): JsonRpcProvider {
  return new JsonRpcProvider(process.env.FLARE_RPC_URL ?? DEFAULT_RPC, COSTON2_CHAIN_ID, {
    staticNetwork: true,
  });
}

/** Bound an on-chain call so an unreachable RPC degrades to an error instead of hanging requests. */
async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: Flare RPC timed out.`)), RPC_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface AnchorInfo {
  chainHead: string; // 0x-prefixed bytes32
  recordCount: number;
  anchoredAt: string; // ISO timestamp
}

export interface AnchorStatus {
  configured: boolean;
  network: "coston2";
  contractAddress: string | null;
  explorerUrl: string | null;
  currentHead: string | null; // ledger's live chain head (0x…)
  currentCount: number;
  headAnchored: boolean;
  latest: AnchorInfo | null;
  /** Set when the chain could not be reached — on-chain fields are then unknown, not "false". */
  rpcError: string | null;
}

export interface AnchorReceipt {
  txHash: string;
  txUrl: string;
  chainHead: string;
  recordCount: number;
  blockNumber: number;
}

/** A registry recordHash is a bare 64-char SHA-256 hex string; EVM wants 0x-prefixed bytes32. */
export function toBytes32(recordHash: string): string {
  if (!/^[0-9a-f]{64}$/i.test(recordHash)) {
    throw new Error(`Not a valid 64-char hex record hash: "${recordHash}"`);
  }
  return `0x${recordHash.toLowerCase()}`;
}

export function txExplorerUrl(txHash: string): string {
  return `${EXPLORER_BASE}/tx/${txHash}`;
}

export function anchorConfigured(): boolean {
  return Boolean(process.env.FLARE_ANCHOR_ADDRESS && process.env.FLARE_DEPLOYER_PRIVATE_KEY);
}

function readContract(): Contract | null {
  const address = process.env.FLARE_ANCHOR_ADDRESS;
  if (!address) return null;
  return new Contract(address, ANCHOR_ABI, newProvider());
}

function writeContract(): Contract {
  const address = process.env.FLARE_ANCHOR_ADDRESS;
  const pk = process.env.FLARE_DEPLOYER_PRIVATE_KEY;
  if (!address || !pk) throw new Error("Flare anchoring is not configured.");
  return new Contract(address, ANCHOR_ABI, new Wallet(pk, newProvider()));
}

/** Live chain head of the local ledger (newest record's hash) plus record count. */
async function ledgerHead(): Promise<{ head: string | null; count: number }> {
  const store = await getStore();
  const records = await store.list(MAX_LEDGER_SCAN);
  if (records.length === 0) return { head: null, count: 0 };
  const newest = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return { head: toBytes32(newest.recordHash), count: records.length };
}

/** Current anchoring state: what the ledger says vs. what is on Flare. */
export async function getAnchorStatus(): Promise<AnchorStatus> {
  const { head, count } = await ledgerHead();
  const contractAddress = process.env.FLARE_ANCHOR_ADDRESS ?? null;

  const status: AnchorStatus = {
    configured: anchorConfigured(),
    network: "coston2",
    contractAddress,
    explorerUrl: contractAddress ? `${EXPLORER_BASE}/address/${contractAddress}` : null,
    currentHead: head,
    currentCount: count,
    headAnchored: false,
    latest: null,
    rpcError: null,
  };

  const contract = readContract();
  if (!contract) return status;

  try {
    const total: bigint = await withTimeout(contract.anchorCount(), "anchorCount");
    if (Number(total) > 0) {
      const latest = await withTimeout(contract.latestAnchor(), "latestAnchor");
      status.latest = {
        chainHead: latest.chainHead,
        recordCount: Number(latest.recordCount),
        anchoredAt: new Date(Number(latest.anchoredAt) * 1000).toISOString(),
      };
    }
    if (head) {
      const [anchored] = await withTimeout(contract.isAnchored(head), "isAnchored");
      status.headAnchored = Boolean(anchored);
    }
  } catch (error: unknown) {
    status.rpcError = error instanceof Error ? error.message : "Flare RPC unreachable.";
  }
  return status;
}

/** Anchor the current ledger head on Flare. Fails fast if there is nothing new. */
export async function anchorLedger(): Promise<AnchorReceipt> {
  const { head, count } = await ledgerHead();
  if (!head) throw new Error("Ledger is empty — register media before anchoring.");

  const contract = writeContract();
  const [alreadyAnchored] = await withTimeout(contract.isAnchored(head), "isAnchored");
  if (alreadyAnchored) throw new Error("Current chain head is already anchored on Flare.");

  const tx = await withTimeout(contract.anchor(head, BigInt(count)), "anchor");
  const receipt = await withTimeout<{ blockNumber: number }>(tx.wait(), "confirmation");

  return {
    txHash: tx.hash,
    txUrl: txExplorerUrl(tx.hash),
    chainHead: head,
    recordCount: count,
    blockNumber: receipt.blockNumber,
  };
}
