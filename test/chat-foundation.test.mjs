import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://localhost:5432/test";

const { db } = await import("../db/client.js");
const {
  buildChatGroupSlug,
  createChatGroup,
  createChatMessage,
} = await import("../lib/chatGroups.mjs");
const {
  banChatMember,
  createChatInvite,
  kickChatMember,
  respondToChatInvite,
} = await import("../lib/chatModeration.mjs");

async function stubDb(overrides, fn) {
  const originals = {};

  for (const [key, value] of Object.entries(overrides)) {
    originals[key] = db[key];
    db[key] = value;
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      db[key] = value;
    }
  }
}

test("buildChatGroupSlug normalizes names into stable slugs", () => {
  assert.equal(buildChatGroupSlug(" Test Squad "), "test-squad");
  assert.equal(buildChatGroupSlug("###"), "group");
});

test("createChatGroup creates owner membership and general channel", async () => {
  const insertCalls = [];
  let selectCall = 0;

  await stubDb(
    {
      select() {
        return {
          from() {
            return {
              where() {
                selectCall += 1;
                return Promise.resolve([{ count: 0 }]);
              },
            };
          },
        };
      },
      insert() {
        return {
          values(payload) {
            insertCalls.push(payload);
            return {
              returning() {
                if (payload.ownerUserId) {
                  return Promise.resolve([{ id: 101, ...payload }]);
                }

                if (payload.groupId && payload.slug === "general") {
                  return Promise.resolve([{ id: 202, ...payload }]);
                }

                return Promise.resolve([payload]);
              },
            };
          },
        };
      },
    },
    async () => {
      const result = await createChatGroup(7, {
        name: "Test Squad",
        description: "Local group",
      });

      assert.equal(selectCall, 1);
      assert.equal(result.group.slug, "test-squad");
      assert.equal(result.channel.slug, "general");
      assert.deepEqual(insertCalls[1], {
        groupId: 101,
        userId: 7,
        role: "owner",
      });
      assert.deepEqual(insertCalls[2], {
        groupId: 101,
        slug: "general",
        name: "general",
        kind: "text",
        position: 0,
      });
    },
  );
});

test("createChatMessage rejects users outside the channel group", async () => {
  let selectCall = 0;

  await stubDb(
    {
      select() {
        return {
          from() {
            return {
              where() {
                selectCall += 1;

                if (selectCall === 1) {
                  return {
                    limit() {
                      return Promise.resolve([
                        {
                          id: 50,
                          groupId: 80,
                          slug: "general",
                          name: "general",
                          kind: "text",
                          position: 0,
                          createdAt: new Date(),
                        },
                      ]);
                    },
                  };
                }

                if (selectCall === 2) {
                  return {
                    limit() {
                      return Promise.resolve([]);
                    },
                  };
                }

                return {
                  limit() {
                    return Promise.resolve([]);
                  },
                };
              },
            };
          },
        };
      },
    },
    async () => {
      await assert.rejects(
        () => createChatMessage(12, { channelId: 50, body: "hello" }),
        /chat_channel_forbidden/,
      );
    },
  );
});

test("createChatInvite blocks inviting existing members", async () => {
  let selectCall = 0;

  await stubDb(
    {
      select() {
        return {
          from() {
            return {
              where() {
                selectCall += 1;

                if (selectCall === 1) {
                  return {
                    limit() {
                      return Promise.resolve([{ groupId: 2, userId: 1, role: "owner" }]);
                    },
                  };
                }

                if (selectCall === 2) {
                  return {
                    limit() {
                      return Promise.resolve([]);
                    },
                  };
                }

                if (selectCall === 3) {
                  return {
                    limit() {
                      return Promise.resolve([{ id: 2 }]);
                    },
                  };
                }

                if (selectCall === 4) {
                  return {
                    limit() {
                      return Promise.resolve([{ groupId: 2, userId: 9, role: "member" }]);
                    },
                  };
                }

                return {
                  limit() {
                    return Promise.resolve([]);
                  },
                };
              },
            };
          },
        };
      },
    },
    async () => {
      await assert.rejects(
        () => createChatInvite(1, { groupId: 2, inviteeUserId: 9 }),
        /chat_invite_already_member/,
      );
    },
  );
});

test("respondToChatInvite adds membership on accept", async () => {
  const insertCalls = [];
  let selectCall = 0;

  await stubDb(
    {
      select() {
        return {
          from() {
            return {
              where() {
                selectCall += 1;
                return {
                  limit() {
                    if (selectCall === 1) {
                      return Promise.resolve([
                        {
                          id: 14,
                          groupId: 4,
                          inviterUserId: 2,
                          inviteeUserId: 8,
                          status: "pending",
                        },
                      ]);
                    }

                    return Promise.resolve([]);
                  },
                };
              },
            };
          },
        };
      },
      insert() {
        return {
          values(payload) {
            insertCalls.push(payload);
            return Promise.resolve();
          },
        };
      },
      update() {
        return {
          set(payload) {
            return {
              where() {
                return {
                  returning() {
                    return Promise.resolve([{ id: 14, status: "accepted", ...payload }]);
                  },
                };
              },
            };
          },
        };
      },
    },
    async () => {
      const invite = await respondToChatInvite(8, { inviteId: 14, action: "accept" });

      assert.equal(invite.status, "accepted");
      assert.deepEqual(insertCalls[0], {
        groupId: 4,
        userId: 8,
        role: "member",
      });
    },
  );
});

test("kickChatMember forbids admin from kicking owner", async () => {
  let selectCall = 0;

  await stubDb(
    {
      select() {
        return {
          from() {
            return {
              where() {
                selectCall += 1;

                if (selectCall === 1) {
                  return {
                    limit() {
                      return Promise.resolve([{ groupId: 6, userId: 2, role: "admin" }]);
                    },
                  };
                }

                if (selectCall === 2) {
                  return {
                    limit() {
                      return Promise.resolve([]);
                    },
                  };
                }

                return {
                  limit() {
                    return Promise.resolve([{ groupId: 6, userId: 1, role: "owner" }]);
                  },
                };
              },
            };
          },
        };
      },
    },
    async () => {
      await assert.rejects(
        () => kickChatMember(2, { groupId: 6, targetUserId: 1 }),
        /chat_group_forbidden/,
      );
    },
  );
});

test("banChatMember removes membership and upserts ban", async () => {
  const deleteCalls = [];

  let selectCall = 0;
  await stubDb(
    {
      select() {
        return {
          from() {
            return {
              where() {
                selectCall += 1;

                if (selectCall === 1) {
                  return {
                    limit() {
                      return Promise.resolve([{ groupId: 9, userId: 3, role: "owner" }]);
                    },
                  };
                }

                if (selectCall === 2) {
                  return {
                    limit() {
                      return Promise.resolve([]);
                    },
                  };
                }

                return {
                  limit() {
                    return Promise.resolve([{ groupId: 9, userId: 7, role: "member" }]);
                  },
                };
              },
            };
          },
        };
      },
      insert() {
        return {
          values(payload) {
            return {
              onConflictDoUpdate() {
                return {
                  returning() {
                    return Promise.resolve([{ id: 1, ...payload }]);
                  },
                };
              },
            };
          },
        };
      },
      delete() {
        return {
          where(payload) {
            deleteCalls.push(payload);
            return Promise.resolve();
          },
        };
      },
      update() {
        return {
          set() {
            return {
              where() {
                return Promise.resolve();
              },
            };
          },
        };
      },
    },
    async () => {
      const ban = await banChatMember(3, { groupId: 9, targetUserId: 7, reason: "spam" });

      assert.equal(ban.userId, 7);
      assert.equal(deleteCalls.length, 1);
    },
  );
});
