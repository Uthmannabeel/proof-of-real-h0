// Creates the Proof of Real DynamoDB table with the three GSIs the app uses.
// Usage:  node scripts/create-table.mjs
// Requires AWS credentials in the environment and (optionally) DYNAMODB_TABLE / AWS_REGION.

import {
  CreateTableCommand,
  DynamoDBClient,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb";

const TableName = process.env.DYNAMODB_TABLE ?? "proof-of-real";
const client = new DynamoDBClient({});

const gsi = (indexName, pk, sk) => ({
  IndexName: indexName,
  KeySchema: [
    { AttributeName: pk, KeyType: "HASH" },
    { AttributeName: sk, KeyType: "RANGE" },
  ],
  Projection: { ProjectionType: "ALL" },
});

async function main() {
  try {
    await client.send(new DescribeTableCommand({ TableName }));
    console.log(`Table "${TableName}" already exists — nothing to do.`);
    return;
  } catch {
    // not found -> create
  }

  await client.send(
    new CreateTableCommand({
      TableName,
      BillingMode: "PAY_PER_REQUEST",
      // Base-table pk/sk carry both REG#<id> records and BAND#<i:val> LSH
      // pointers, so near-match needs no GSI. GSI1 = exact content lookup,
      // GSI3 = recent ledger.
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
        { AttributeName: "gsi1pk", AttributeType: "S" },
        { AttributeName: "gsi1sk", AttributeType: "S" },
        { AttributeName: "gsi3pk", AttributeType: "S" },
        { AttributeName: "gsi3sk", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        gsi("GSI1", "gsi1pk", "gsi1sk"),
        gsi("GSI3", "gsi3pk", "gsi3sk"),
      ],
    }),
  );

  console.log(`Created table "${TableName}" (PAY_PER_REQUEST) with GSI1/GSI2/GSI3.`);
}

main().catch((err) => {
  console.error("Failed to create table:", err);
  process.exit(1);
});
