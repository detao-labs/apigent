import { describe, it, expect } from "vitest";
import { parseOpenAPI } from "./parser";
import type { ParseInput } from "./types";

// ═══════════════════════════════════════════════════════════════════
// Sample OpenAPI 3.0.3 spec (Petstore-like)
// ═══════════════════════════════════════════════════════════════════

const SAMPLE_SPEC = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Pet Store API", version: "1.0.0" },
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        summary: "List all pets",
        description: "Returns all pets from the system",
        tags: ["pets"],
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Max number of pets to return",
            schema: { type: "integer" },
          },
        ],
        responses: {
          "200": {
            description: "A list of pets",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Pets" },
              },
            },
          },
        },
      },
      post: {
        operationId: "createPet",
        summary: "Create a pet",
        tags: ["pets"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Pet" },
            },
          },
        },
        responses: {
          "201": { description: "Created" },
          "400": { description: "Invalid input" },
        },
      },
    },
    "/pets/{petId}": {
      get: {
        operationId: "getPet",
        summary: "Get a pet by ID",
        tags: ["pets"],
        parameters: [
          {
            name: "petId",
            in: "path",
            required: true,
            description: "The pet ID",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "A pet",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Pet" },
              },
            },
          },
          "404": { description: "Pet not found" },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "integer", description: "Unique identifier" },
          name: { type: "string", description: "Pet name" },
          tag: { type: "string", description: "Tag" },
        },
      },
      Pets: {
        type: "array",
        items: { $ref: "#/components/schemas/Pet" },
      },
    },
    securitySchemes: {
      apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
    },
  },
  security: [{ apiKey: [] }],
});

const SAMPLE_YAML = `
openapi: "3.0.3"
info:
  title: "Simple API"
  version: "1.0.0"
paths:
  /health:
    get:
      operationId: healthCheck
      summary: Health check
      responses:
        "200":
          description: OK
`;

function input(json: string): ParseInput {
  return { source: "text", content: json, repoId: "test-repo-1" };
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe("parseOpenAPI", () => {
  describe("JSON parsing", () => {
    it("parses a valid OpenAPI 3.0.3 JSON spec", () => {
      const result = parseOpenAPI(input(SAMPLE_SPEC));

      expect(result.repoId).toBe("test-repo-1");
      expect(result.apis).toHaveLength(3);
      expect(result.schemas).toHaveLength(2);
      expect(result.meta.openapiVersion).toBe("3.0.3");
      expect(result.meta.specTitle).toBe("Pet Store API");
      expect(result.meta.specVersion).toBe("1.0.0");
    });

    it("extracts correct API ids", () => {
      const result = parseOpenAPI(input(SAMPLE_SPEC));
      const ids = result.apis.map((a) => a.id).sort();
      expect(ids).toEqual(["GET:/pets", "GET:/pets/{petId}", "POST:/pets"]);
    });

    it("extracts HTTP methods and paths correctly", () => {
      const result = parseOpenAPI(input(SAMPLE_SPEC));
      const getPets = result.apis.find((a) => a.id === "GET:/pets")!;
      expect(getPets.method).toBe("GET");
      expect(getPets.path).toBe("/pets");
      expect(getPets.operationId).toBe("listPets");
      expect(getPets.summary).toBe("List all pets");
      expect(getPets.tags).toEqual(["pets"]);
    });

    it("extracts parameters", () => {
      const result = parseOpenAPI(input(SAMPLE_SPEC));
      const getPets = result.apis.find((a) => a.id === "GET:/pets")!;
      expect(getPets.parameters).toHaveLength(1);
      expect(getPets.parameters[0].name).toBe("limit");
      expect(getPets.parameters[0].in).toBe("query");
      expect(getPets.parameters[0].required).toBe(false);

      const getPet = result.apis.find((a) => a.id === "GET:/pets/{petId}")!;
      expect(getPet.parameters).toHaveLength(1);
      expect(getPet.parameters[0].name).toBe("petId");
      expect(getPet.parameters[0].in).toBe("path");
      expect(getPet.parameters[0].required).toBe(true);
    });

    it("merges path-level parameters into operations", () => {
      const spec = JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Test", version: "1.0" },
        paths: {
          "/pets/{petId}": {
            parameters: [
              { name: "petId", in: "path", required: true, schema: { type: "string" } },
              { name: "verbose", in: "query", schema: { type: "boolean" } },
            ],
            get: {
              operationId: "getPet",
              parameters: [
                { name: "verbose", in: "query", required: true, schema: { type: "boolean" } },
              ],
              responses: { "200": { description: "OK" } },
            },
          },
        },
      });
      const result = parseOpenAPI(input(spec));
      const api = result.apis[0];
      expect(api.parameters).toHaveLength(2);
      expect(api.parameters.find((p) => p.name === "petId")).toBeDefined();
      // Operation-level parameter wins the collision on (name, in)
      expect(api.parameters.find((p) => p.name === "verbose")?.required).toBe(true);
    });

    it("extracts request body", () => {
      const result = parseOpenAPI(input(SAMPLE_SPEC));
      const postPets = result.apis.find((a) => a.id === "POST:/pets")!;
      expect(postPets.requestBody).toBeDefined();
      // After $ref resolution, the schema is resolved to its inline value
      expect(postPets.requestBody!.schema).toBeDefined();
      const schema = postPets.requestBody!.schema!;
      expect(schema.type).toBe("object");
    });

    it("extracts responses", () => {
      const result = parseOpenAPI(input(SAMPLE_SPEC));
      const getPet = result.apis.find((a) => a.id === "GET:/pets/{petId}")!;
      expect(getPet.responses).toHaveLength(2);
      expect(getPet.responses.map((r) => r.statusCode).sort()).toEqual(["200", "404"]);
    });

    it("extracts data models from components/schemas", () => {
      const result = parseOpenAPI(input(SAMPLE_SPEC));
      expect(result.schemas).toHaveLength(2);
      const pet = result.schemas.find((s) => s.name === "Pet")!;
      expect(pet.type).toBe("object");
      expect(pet.required).toEqual(["id", "name"]);
      expect(Object.keys(pet.properties)).toEqual(["id", "name", "tag"]);
    });

    it("extracts security requirements", () => {
      const result = parseOpenAPI(input(SAMPLE_SPEC));
      const getPets = result.apis.find((a) => a.id === "GET:/pets")!;
      expect(getPets.security).toEqual([{ apiKey: [] }]);
    });

    it("detects deprecated endpoints", () => {
      const spec = JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Test", version: "1.0" },
        paths: {
          "/old": {
            get: {
              operationId: "oldEndpoint",
              deprecated: true,
              responses: { "200": { description: "OK" } },
            },
          },
        },
      });
      const result = parseOpenAPI(input(spec));
      expect(result.apis[0].deprecated).toBe(true);
    });
  });

  describe("YAML parsing", () => {
    it("parses a valid YAML spec", () => {
      const result = parseOpenAPI(input(SAMPLE_YAML));
      expect(result.apis).toHaveLength(1);
      expect(result.apis[0].id).toBe("GET:/health");
      expect(result.meta.specTitle).toBe("Simple API");
    });
  });

  describe("$ref resolution", () => {
    it("resolves $ref references in the document", () => {
      const result = parseOpenAPI(input(SAMPLE_SPEC));
      // The parser resolves refs internally; the resolved schemas
      // should be accessible in the schemas array
      const pets = result.schemas.find((s) => s.name === "Pets")!;
      expect(pets.type).toBe("array");
    });

    it("handles circular refs without hanging", () => {
      const spec = JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Test", version: "1.0" },
        paths: {
          "/nodes": {
            get: {
              operationId: "listNodes",
              responses: {
                "200": {
                  description: "OK",
                  content: {
                    "application/json": { schema: { $ref: "#/components/schemas/Node" } },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            Node: {
              type: "object",
              properties: {
                children: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Node" },
                },
              },
            },
          },
        },
      });
      const result = parseOpenAPI(input(spec));
      expect(result.apis).toHaveLength(1);
      expect(
        result.parseIssues.some((i) => i.message.includes("Circular $ref")),
      ).toBe(true);
    });
  });

  describe("validation warnings", () => {
    it("warns about missing operationId", () => {
      const spec = JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Test", version: "1.0" },
        paths: {
          "/test": {
            get: {
              responses: { "200": { description: "OK" } },
            },
          },
        },
      });
      const result = parseOpenAPI(input(spec));
      const warnings = result.parseIssues.filter((i) => i.severity === "warning");
      expect(warnings.some((w) => w.message.includes("Missing operationId"))).toBe(true);
    });

    it("warns about paths not starting with /", () => {
      // This can't happen with the current extraction since we key by path, but
      // we test the validator's behavior via manual path validation
      const spec = JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Test", version: "1.0" },
        paths: {
          "pets": {
            get: {
              operationId: "listPets",
              responses: { "200": { description: "OK" } },
            },
          },
        },
      });
      const result = parseOpenAPI(input(spec));
      const pathWarning = result.parseIssues.find(
        (i) => i.severity === "warning" && i.message.includes("does not start with '/'"),
      );
      expect(pathWarning).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("returns empty model for empty string", () => {
      const result = parseOpenAPI(input(""));
      expect(result.apis).toHaveLength(0);
      expect(result.parseIssues.some((i) => i.severity === "error")).toBe(true);
    });

    it("returns empty model for invalid JSON", () => {
      const result = parseOpenAPI(input("{invalid json!!!"));
      expect(result.apis).toHaveLength(0);
      expect(result.parseIssues.some((i) => i.severity === "error")).toBe(true);
    });

    it("errors on Swagger 2.0 specs", () => {
      const swagger = JSON.stringify({
        swagger: "2.0",
        info: { title: "Old API", version: "1.0" },
        paths: {},
      });
      const result = parseOpenAPI(input(swagger));
      expect(result.apis).toHaveLength(0);
      expect(
        result.parseIssues.some((i) => i.message.includes("Swagger 2.0")),
      ).toBe(true);
    });

    it("errors on non-OpenAPI documents", () => {
      const result = parseOpenAPI(input(JSON.stringify({ foo: "bar" })));
      expect(result.apis).toHaveLength(0);
      expect(
        result.parseIssues.some((i) => i.message.includes("not a valid OpenAPI")),
      ).toBe(true);
    });

    it("skips APIs with errors but continues parsing others", () => {
      const spec = JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Test", version: "1.0" },
        paths: {
          "/valid": {
            get: {
              operationId: "valid",
              responses: { "200": { description: "OK" } },
            },
          },
          "/broken": {
            post: {
              // Missing operationId (warning) + no path (can't happen from path key, but
              // test error tolerance by having an invalid method
              responses: {},
            },
          },
        },
      });
      const result = parseOpenAPI(input(spec));
      // POST /broken should be included (only warnings for missing operationId, empty responses)
      const broken = result.apis.find((a) => a.id === "POST:/broken");
      expect(broken).toBeDefined();
      const warnings = result.parseIssues.filter((i) => i.severity === "warning");
      expect(warnings.length).toBeGreaterThan(0);
    });
  });
});
