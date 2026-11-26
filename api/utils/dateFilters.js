import { eq, or, sql } from "drizzle-orm";

export function toSqlDateLiteral(dateString) {
  return sql`${dateString}::date`;
}

export function buildDateInFilter(column, dateStrings = []) {
  const uniqueDates = Array.from(
    new Set((Array.isArray(dateStrings) ? dateStrings : []).filter(Boolean)),
  );

  if (!uniqueDates.length) return undefined;
  if (uniqueDates.length === 1) {
    return eq(column, toSqlDateLiteral(uniqueDates[0]));
  }

  return or(...uniqueDates.map((dateString) => eq(column, toSqlDateLiteral(dateString))));
}
