// api/openapi.js
// Отдаёт OpenAPI JSON для /api/champions и /api/champion-history

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

      "/api/champion-history": {
        get: {
          summary: "Champion stats history (CN)",
          description:
            "Возвращает историю винрейтов/пикрейтов/банрейтов по чемпионам из китайского API hero_rank_list_v2.",
          parameters: [
            {
              name: "slug",
              in: "query",
              description: "Champion slug (e.g. nunu, kayle)",
              required: false,
              schema: { type: "string", example: "nunu" },
            },
            {
              name: "rank",
              in: "query",
              description:
                "Rank filter (overall, diamondPlus, masterPlus, king, peak). Можно несколько через запятую.",
              required: false,
              schema: { type: "string", example: "diamondPlus,masterPlus" },
            },
            {
              name: "lane",
              in: "query",
              description:
                "Lane filter (mid, top, adc, support, jungle). Можно несколько через запятую.",
              required: false,
              schema: { type: "string", example: "mid,top" },
            },
            {
              name: "date",
              in: "query",
              description:
                "Конкретная дата в формате YYYY-MM-DD. Если указана, from/to игнорируются.",
              required: false,
              schema: { type: "string", format: "date", example: "2025-12-02" },
            },
            {
              name: "from",
              in: "query",
              description:
                "Начало диапазона дат (включительно), формат YYYY-MM-DD.",
              required: false,
              schema: { type: "string", format: "date", example: "2025-12-01" },
            },
            {
              name: "to",
              in: "query",
              description:
                "Конец диапазона дат (включительно), формат YYYY-MM-DD.",
              required: false,
              schema: { type: "string", format: "date", example: "2025-12-10" },
            },
          ],
          responses: {
            200: {
              description: "History entries",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      filters: {
                        type: "object",
                        properties: {
                          slug: { type: "string", nullable: true },
                          rank: {
                            type: "array",
                            items: { type: "string" },
                            nullable: true,
                          },
                          lane: {
                            type: "array",
                            items: { type: "string" },
                            nullable: true,
                          },
                          from: {
                            type: "string",
                            format: "date",
                            nullable: true,
                          },
                          to: {
                            type: "string",
                            format: "date",
                            nullable: true,
                          },
                        },
                      },
                      count: { type: "integer" },
                      items: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            date: { type: "string", format: "date" },
                            slug: { type: "string" },
                            cnHeroId: { type: "string" },
                            rank: { type: "string" },
                            lane: { type: "string" },
                            position: { type: "integer", nullable: true },
                            winRate: {
                              type: "number",
                              format: "double",
                              nullable: true,
                            },
                            pickRate: {
                              type: "number",
                              format: "double",
                              nullable: true,
                            },
                            banRate: {
                              type: "number",
                              format: "double",
                              nullable: true,
                            },
                            strengthLevel: {
                              type: "integer",
                              nullable: true,
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
    },
  };

  res.setHeader("Content-Type", "application/json");
  res.status(200).json(spec);
}
