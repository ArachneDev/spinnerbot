import { createDatabase, runMigrations, schema } from "@scrimbot/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addStaffRole, removeStaffRole, staffRoleIds } from "../src/framework/staff-roles.js";

const url = process.env["TEST_DATABASE_URL"];
if (!url) throw new Error("Set TEST_DATABASE_URL");
const database = createDatabase(url);
const { db } = database;

beforeAll(() => runMigrations(url));
afterAll(() => database.sql.end());
beforeEach(() => db.delete(schema.staffRoles));

describe("staff role store", () => {
  it("keeps each server's roles apart", async () => {
    expect(await staffRoleIds(db, "100000000000000001")).toEqual([]);
    expect(await addStaffRole(db, "100000000000000001", "100000000000000099")).toBe(true);
    expect(await addStaffRole(db, "100000000000000002", "100000000000000098")).toBe(true);
    expect(await staffRoleIds(db, "100000000000000001")).toEqual(["100000000000000099"]);
  });

  it("reports adding a role twice, and removing one that is not there", async () => {
    expect(await addStaffRole(db, "100000000000000001", "100000000000000099")).toBe(true);
    expect(await addStaffRole(db, "100000000000000001", "100000000000000099")).toBe(false);
    expect(await removeStaffRole(db, "100000000000000002", "100000000000000099")).toBe(false);
    expect(await removeStaffRole(db, "100000000000000001", "100000000000000099")).toBe(true);
    expect(await staffRoleIds(db, "100000000000000001")).toEqual([]);
  });
});
