CREATE TABLE "Vault" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tokenHash" TEXT NOT NULL
);
CREATE UNIQUE INDEX "Vault_tokenHash_key" ON "Vault"("tokenHash");
CREATE TABLE "Event" (
  "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "vaultId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "time_start" TEXT NOT NULL,
  "time_end" TEXT NOT NULL,
  "started_at" REAL NOT NULL,
  "ended_at" REAL NOT NULL,
  "duration_seconds" REAL NOT NULL,
  "completed" BOOLEAN NOT NULL,
  CONSTRAINT "Event_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "Vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Event_vaultId_id_key" ON "Event"("vaultId", "id");
CREATE INDEX "Event_vaultId_sequence_idx" ON "Event"("vaultId", "sequence");
