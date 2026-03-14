import { describe, it, expect } from "vitest";
import { detectCounterTypes, detectCounterType, stripCounterTag } from "../detectCounterType";

describe("detectCounterTypes", () => {
    it("detects single counter tag", () => {
        expect(detectCounterTypes("Записал факт! [COUNTER:facts]")).toEqual(["facts"]);
    });

    it("detects multiple counter tags", () => {
        const input = "Записал факт и задачу! [COUNTER:facts] [COUNTER:tasks]";
        expect(detectCounterTypes(input)).toEqual(["facts", "tasks"]);
    });

    it("detects all four types", () => {
        const input = "[COUNTER:ideas] [COUNTER:facts] [COUNTER:persons] [COUNTER:tasks]";
        expect(detectCounterTypes(input)).toEqual(["ideas", "facts", "persons", "tasks"]);
    });

    it("returns empty array for no tags", () => {
        expect(detectCounterTypes("Обычный ответ без тегов")).toEqual([]);
    });

    it("is case-insensitive", () => {
        expect(detectCounterTypes("[COUNTER:IDEAS]")).toEqual(["ideas"]);
    });
});

describe("detectCounterType (legacy)", () => {
    it("returns first counter type", () => {
        expect(detectCounterType("[COUNTER:facts] [COUNTER:tasks]")).toBe("facts");
    });

    it("returns null for no tags", () => {
        expect(detectCounterType("Нет тегов")).toBeNull();
    });
});

describe("stripCounterTag", () => {
    it("strips single counter tag", () => {
        expect(stripCounterTag("Текст [COUNTER:facts]")).toBe("Текст");
    });

    it("strips multiple counter tags", () => {
        expect(stripCounterTag("Текст [COUNTER:facts] [COUNTER:tasks]")).toBe("Текст");
    });

    it("returns text unchanged if no tags", () => {
        expect(stripCounterTag("Обычный текст")).toBe("Обычный текст");
    });
});
