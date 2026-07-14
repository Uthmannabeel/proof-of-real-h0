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
const EXPLORER_BASE = "https://coston2-explorer.flare.network";
const MAX_LEDGER_SCAN = 1000;

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
  const provider = new JsonRpcProvider(process.env.FLARE_RPC_URL ?? DEFAULT_RPC);
  return new Contract(address, ANCHOR_ABI, provider);
}

function writeContract(): Contract {
  const address = process.env.FLARE_ANCHOR_ADDRESS;
  const pk = process.env.FLARE_DEPLOYER_PRIVATE_KEY;
  if (!address || !pk) throw new Error("Flare anchoring is not configured.");
  const provider = new JsonRpcProvider(process.env.FLARE_RPC_URL ?? DEFAULT_RPC);
  return new Contract(address, ANCHOR_ABI, new Wallet(pk, provider));
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
  };

  const contract = readContract();
  if (!contract) return status;

  const total: bigint = await contract.anchorCount();
  if (Number(total) > 0) {
    const latest = await contract.latestAnchor();
    status.latest = {
      chainHead: latest.chainHead,
      recordCount: Number(latest.recordCount),
      anchoredAt: new Date(Number(latest.anchoredAt) * 1000).toISOString(),
    };
  }
  if (head) {
    const [anchored] = await contract.isAnchored(head);
    status.headAnchored = Boolean(anchored);
  }
  return status;
}

/** Anchor the current ledger head on Flare. Fails fast if there is nothing new. */
export async function anchorLedger(): Promise<AnchorReceipt> {
  const { head, count } = await ledgerHead();
  if (!head) throw new Error("Ledger is empty — register media before anchoring.");

  const contract = writeContract();
  const [alreadyAnchored] = await contract.isAnchored(head);
  if (alreadyAnchored) throw new Error("Current chain head is already anchored on Flare.");

  const tx = await contract.anchor(head, BigInt(count));
  const receipt = await tx.wait();

  return {
    txHash: tx.hash,
    txUrl: txExplorerUrl(tx.hash),
    chainHead: head,
    recordCount: count,
    blockNumber: receipt.blockNumber,
  };
}
