CREATE TABLE "endpoint_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"status_code" varchar(3) NOT NULL,
	"description" text,
	"headers" jsonb DEFAULT '[]'::jsonb,
	"content" jsonb,
	"is_error" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "endpoint_responses" ADD CONSTRAINT "endpoint_responses_endpoint_id_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "endpoint_responses_endpoint_status_idx" ON "endpoint_responses" USING btree ("endpoint_id","status_code");--> statement-breakpoint
ALTER TABLE "endpoints" DROP COLUMN "response_schema";