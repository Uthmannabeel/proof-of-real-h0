import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Registration } from "./types";
import type { NearMatch, ProvenanceStore } from "./store";
import { hammingDistance } from "./hash";

const TABLE = process.env.DYNAMODB_TABLE ?? "proof-of-real";
const SCAN_FALLBACK_LIMIT = 500;

interface StoredItem {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
  gsi3pk: string;
  gsi3sk: string;
  record: Registration;
}

/**
 * DynamoDB-backed registry. Single table with three GSIs:
 *   GSI1 (gsi1pk=CONTENT#<sha256>)  -> exact-original lookup, O(1)
 *   GSI2 (gsi2pk=BUCKET#<phash12b>) -> perceptual candidates by fingerprint bucket
 *   GSI3 (gsi3pk=ALL)               -> recent registrations, time-ordered
 */
export class DynamoStore implements ProvenanceStore {
  private readonly doc: DynamoDBDocumentClient;

  constructor() {
    const client = new DynamoDBClient({});
    this.doc = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async put(record: Registration): Promise<void> {
    const item: StoredItem = {
      pk: `REG#${record.id}`,
      sk: "META",
      gsi1pk: `CONTENT#${record.contentHash}`,
      gsi1sk: record.createdAt,
      gsi2pk: `BUCKET#${record.phashBucket}`,
      gsi2sk: record.createdAt,
      gsi3pk: "ALL",
      gsi3sk: record.createdAt,
      record,
    };
    await this.doc.send(new PutCommand({ TableName: TABLE, Item: item }));
  }

  async getById(id: string): Promise<Registration | null> {
    const res = await this.doc.send(
      new GetCommand({ TableName: TABLE, Key: { pk: `REG#${id}`, sk: "META" } }),
    );
    return res.Item ? (res.Item as StoredItem).record : null;
  }

  async findByContentHash(contentHash: string): Promise<Registration | null> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "GSI1",
        KeyConditionExpression: "gsi1pk = :pk",
        ExpressionAttributeValues: { ":pk": `CONTENT#${contentHash}` },
        Limit: 1,
      }),
    );
    const item = res.Items?.[0] as StoredItem | undefined;
    return item ? item.record : null;
  }

  async findNearest(phash: string, maxDistance: number): Promise<NearMatch | null> {
    const bucket = phash.slice(0, 3);
    const candidates = await this.queryBucket(bucket);
    const best = pickNearest(phash, candidates, maxDistance);
    if (best) return best;

    // Bucket miss (an edit shifted the fingerprint prefix): bounded scan fallback.
    const scanned = await this.scanSome();
    return pickNearest(phash, scanned, maxDistance);
  }

  async list(limit: number): Promise<Registration[]> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "GSI3",
        KeyConditionExpression: "gsi3pk = :pk",
        ExpressionAttributeValues: { ":pk": "ALL" },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (res.Items ?? []).map((i) => (i as StoredItem).record);
  }

  private async queryBucket(bucket: string): Promise<Registration[]> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "GSI2",
        KeyConditionExpression: "gsi2pk = :pk",
        ExpressionAttributeValues: { ":pk": `BUCKET#${bucket}` },
      }),
    );
    return (res.Items ?? []).map((i) => (i as StoredItem).record);
  }

  private async scanSome(): Promise<Registration[]> {
    const res = await this.doc.send(
      new ScanCommand({ TableName: TABLE, Limit: SCAN_FALLBACK_LIMIT }),
    );
    return (res.Items ?? [])
      .filter((i) => (i as StoredItem).sk === "META")
      .map((i) => (i as StoredItem).record);
  }
}

function pickNearest(
  phash: string,
  records: Registration[],
  maxDistance: number,
): NearMatch | null {
  let best: NearMatch | null = null;
  for (const record of records) {
    const distance = hammingDistance(phash, record.phash);
    if (distance <= maxDistance && (best === null || distance < best.distance)) {
      best = { record, distance };
    }
  }
  return best;
}
