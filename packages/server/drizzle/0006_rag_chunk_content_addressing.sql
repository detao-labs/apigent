CREATE TABLE "knowledge_chunk_links" (
	"commit_id" text NOT NULL,
	"chunk_id" text NOT NULL,
	CONSTRAINT "knowledge_chunk_links_commit_id_chunk_id_pk" PRIMARY KEY("commit_id","chunk_id")
);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" DROP CONSTRAINT "knowledge_chunks_version_id_version_commits_id_fk";
--> statement-breakpoint
DROP INDEX "knowledge_chunks_repository_key_idx";--> statement-breakpoint
ALTER TABLE "knowledge_chunk_links" ADD CONSTRAINT "knowledge_chunk_links_commit_id_version_commits_id_fk" FOREIGN KEY ("commit_id") REFERENCES "public"."version_commits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunk_links" ADD CONSTRAINT "knowledge_chunk_links_chunk_id_knowledge_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."knowledge_chunks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_chunk_links_chunk_idx" ON "knowledge_chunk_links" USING btree ("chunk_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_repository_key_hash_idx" ON "knowledge_chunks" USING btree ("repository_id","chunk_key","content_hash");--> statement-breakpoint
ALTER TABLE "knowledge_chunks" DROP COLUMN "version_id";