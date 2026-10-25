import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { testEnvironment } from "./helpers.js";

describe("migrações D1", () => {
  it("produz o mesmo schema do snapshot para um banco novo", () => {
    const { sqlite } = testEnvironment();
    const snapshot = new DatabaseSync(":memory:");
    snapshot.exec(readFileSync(new URL("../src/server/db/schema.sql", import.meta.url), "utf8"));
    const query = "SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name";
    expect(snapshot.prepare(query).all()).toEqual(sqlite.prepare(query).all());
    snapshot.close(); sqlite.close();
  });

  it("isola fotos legadas sem evidência de prévia e consolida dorsais antigos", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync(new URL("../src/server/db/migrations/0001_baseline.sql", import.meta.url), "utf8"));
    db.exec(`INSERT INTO photos (id, album_id, photographer_id, preview_url, original_r2_key)
      VALUES ('legacy', 'album', 'owner', '/untrusted-preview.jpg', 'originals/legacy.jpg');
      INSERT INTO photo_bibs (id, photo_id, bib_number, confidence) VALUES
      ('a', 'legacy', '123', 0.8), ('b', 'legacy', '123', 0.9), ('c', 'legacy', '999999', 0.9);`);
    db.exec(readFileSync(new URL("../src/server/db/migrations/0002_photo_pipeline.sql", import.meta.url), "utf8"));
    expect(db.prepare("SELECT status, original_r2_key FROM photos").get()).toMatchObject({ status: "draft", original_r2_key: "originals/legacy.jpg" });
    expect(db.prepare("SELECT bib_number, confidence FROM photo_bibs").all()).toEqual([{ bib_number: "123", confidence: 0.9 }]);
    db.close();
  });
});
