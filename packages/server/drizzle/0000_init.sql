CREATE TABLE "business_contexts" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint_id" text NOT NULL,
	"version_id" text NOT NULL,
	"capability_name" varchar(255),
	"intent" text,
	"constraints" jsonb DEFAULT '[]'::jsonb,
	"side_effects" text,
	"usage_scenarios" jsonb DEFAULT '[]'::jsonb,
	"generated_by" varchar(100),
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_models" (
	"id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"schema_type" varchar(50),
	"schema_raw" jsonb NOT NULL,
	"description" text,
	"is_modified" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "endpoint_modules" (
	"endpoint_id" text NOT NULL,
	"module_id" text NOT NULL,
	CONSTRAINT "endpoint_modules_endpoint_id_module_id_pk" PRIMARY KEY("endpoint_id","module_id")
);
--> statement-breakpoint
CREATE TABLE "endpoint_relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"source_endpoint_id" text NOT NULL,
	"target_endpoint_id" text NOT NULL,
	"relation_type" varchar(50) NOT NULL,
	"repo_id" text NOT NULL,
	"version_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "endpoint_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint_id" text NOT NULL,
	"status_code" varchar(3) NOT NULL,
	"description" text,
	"headers" jsonb DEFAULT '[]'::jsonb,
	"content_type" varchar(100),
	"schema" jsonb,
	"is_error" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"operation_id" varchar(255),
	"method" varchar(10) NOT NULL,
	"path" varchar(500) NOT NULL,
	"summary" text,
	"description" text,
	"request_content_type" varchar(100),
	"request_schema" jsonb,
	"parameters" jsonb DEFAULT '[]'::jsonb,
	"deprecated" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"version_id" text,
	"endpoint_id" text,
	"parent_id" text,
	"chunk_key" varchar(512) NOT NULL,
	"level" varchar(20) NOT NULL,
	"lang" varchar(10) DEFAULT 'en' NOT NULL,
	"content" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(1024),
	"search_vector" "tsvector",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modules" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"version_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "operation_log_details" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_id" text NOT NULL,
	"change_type" varchar(20) NOT NULL,
	"operation_id_ref" varchar(255),
	"method" varchar(10) NOT NULL,
	"path" varchar(500) NOT NULL,
	"from_endpoint_id" text,
	"to_endpoint_id" text,
	"fields_changed" jsonb
);
--> statement-breakpoint
CREATE TABLE "operation_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"repo_id" text,
	"actor_id" text,
	"operation_type" varchar(50) NOT NULL,
	"resource_type" varchar(50) NOT NULL,
	"resource_id" text,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"role" varchar(50) NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_user_id_org_id_pk" PRIMARY KEY("user_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_permissions" (
	"user_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"role" varchar(50) NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_permissions_user_id_repo_id_pk" PRIMARY KEY("user_id","repo_id")
);
--> statement-breakpoint
CREATE TABLE "repo_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"version" varchar(50) NOT NULL,
	"spec_version" varchar(100),
	"spec_storage_path" varchar(500) NOT NULL,
	"source" varchar(20) DEFAULT 'import',
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"capability_context" jsonb DEFAULT '{}'::jsonb,
	"current_version_id" text,
	"mcp_enabled" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"key_hash" varchar(255) NOT NULL,
	"key_prefix" varchar(20) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"avatar_url" text,
	"sso_providers" jsonb DEFAULT '[]'::jsonb,
	"is_platform_admin" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "business_contexts" ADD CONSTRAINT "business_contexts_endpoint_id_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_contexts" ADD CONSTRAINT "business_contexts_version_id_repo_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."repo_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_models" ADD CONSTRAINT "data_models_version_id_repo_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."repo_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_models" ADD CONSTRAINT "data_models_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_modules" ADD CONSTRAINT "endpoint_modules_endpoint_id_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_modules" ADD CONSTRAINT "endpoint_modules_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_relationships" ADD CONSTRAINT "endpoint_relationships_source_endpoint_id_endpoints_id_fk" FOREIGN KEY ("source_endpoint_id") REFERENCES "public"."endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_relationships" ADD CONSTRAINT "endpoint_relationships_target_endpoint_id_endpoints_id_fk" FOREIGN KEY ("target_endpoint_id") REFERENCES "public"."endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_relationships" ADD CONSTRAINT "endpoint_relationships_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_relationships" ADD CONSTRAINT "endpoint_relationships_version_id_repo_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."repo_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_responses" ADD CONSTRAINT "endpoint_responses_endpoint_id_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoints" ADD CONSTRAINT "endpoints_version_id_repo_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."repo_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoints" ADD CONSTRAINT "endpoints_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_version_id_repo_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."repo_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_endpoint_id_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_parent_id_knowledge_chunks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."knowledge_chunks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_version_id_repo_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."repo_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_log_details" ADD CONSTRAINT "operation_log_details_operation_id_operation_logs_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operation_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_log_details" ADD CONSTRAINT "operation_log_details_from_endpoint_id_endpoints_id_fk" FOREIGN KEY ("from_endpoint_id") REFERENCES "public"."endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_log_details" ADD CONSTRAINT "operation_log_details_to_endpoint_id_endpoints_id_fk" FOREIGN KEY ("to_endpoint_id") REFERENCES "public"."endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_permissions" ADD CONSTRAINT "repo_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_permissions" ADD CONSTRAINT "repo_permissions_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_versions" ADD CONSTRAINT "repo_versions_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_keys" ADD CONSTRAINT "secret_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_contexts_endpoint_version_idx" ON "business_contexts" USING btree ("endpoint_id","version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "data_models_version_name_idx" ON "data_models" USING btree ("version_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "endpoint_relations_unique_idx" ON "endpoint_relationships" USING btree ("source_endpoint_id","target_endpoint_id","relation_type");--> statement-breakpoint
CREATE UNIQUE INDEX "endpoint_responses_endpoint_status_content_type_idx" ON "endpoint_responses" USING btree ("endpoint_id","status_code","content_type");--> statement-breakpoint
CREATE UNIQUE INDEX "endpoints_version_method_path_idx" ON "endpoints" USING btree ("version_id","method","path");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_repo_key_idx" ON "knowledge_chunks" USING btree ("repo_id","chunk_key");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_org_idx" ON "knowledge_chunks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_endpoint_idx" ON "knowledge_chunks" USING btree ("endpoint_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_parent_idx" ON "knowledge_chunks" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_search_vector_gin_idx" ON "knowledge_chunks" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_embedding_hnsw_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "modules_version_name_idx" ON "modules" USING btree ("version_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "op_log_details_unique_idx" ON "operation_log_details" USING btree ("operation_id","method","path");--> statement-breakpoint
CREATE INDEX "op_logs_org_type_time_idx" ON "operation_logs" USING btree ("org_id","operation_type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "repo_versions_repo_version_idx" ON "repo_versions" USING btree ("repo_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");