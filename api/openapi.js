// api/openapi.js
// Отдаёт OpenAPI JSON для /api/champions

export default function handler(req, res) {
  const spec = {
    openapi: "3.0.0",
    info: {
      title: "WR API",
      version: "1.0.0",
      description: "Wild Rift champions API",
    },
    paths: {
      "/api/champions": {
        get: {
          summary: "List champions",
          parameters: [
            {
              name: "lang",
              in: "query",
              description: "Localization language (ru_ru, en_us, zh_cn)",
              required: false,
              schema: { type: "string", example: "ru_ru" },
            },
          ],
          responses: {
            200: {
              description: "List of champions",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        slug: { type: "string" },
                        name: { type: "string" },
                        nameLocalizations: {
                          type: "object",
                          additionalProperties: { type: "string" },
                        },
                        roles: {
                          type: "array",
                          items: { type: "string" },
                        },
                        rolesLocalized: {
                          type: "array",
                          items: { type: "string" },
                        },
                        difficulty: { type: "string" },
                        difficultyLocalized: { type: "string" },
                        icon: { type: "string", format: "uri" },
                        ids: {
                          type: "object",
                          properties: {
                            slug: { type: "string" },
                            cnHeroId: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  res.setHeader("Content-Type", "application/json");
  res.status(200).json(spec);
}
