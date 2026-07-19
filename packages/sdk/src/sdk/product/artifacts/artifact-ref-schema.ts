export const artifactRefJsonSchema = {
  additionalProperties: false,
  properties: {
    artifactId: { minLength: 1, type: "string" },
    kind: { minLength: 1, type: "string" },
    mediaType: { minLength: 1, type: "string" },
    metadata: {
      additionalProperties: true,
      type: "object",
    },
    title: { minLength: 1, type: "string" },
    uri: { minLength: 1, type: "string" },
  },
  required: ["artifactId", "kind"],
  type: "object",
} as const;
