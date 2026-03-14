import { describe, it, expect } from "vitest";
import { stripDSML } from "../stripDSML";

describe("stripDSML", () => {
    it("returns clean text unchanged", () => {
        expect(stripDSML("Привет, мир!")).toBe("Привет, мир!");
    });

    it("strips full DSML tag — < | DSML | function_calls>", () => {
        const input = 'Заметка создана! < | DSML | function_calls>< | DSML | invoke name="create_zettel">...';
        expect(stripDSML(input)).toBe("Заметка создана!");
    });

    it("strips DSML with invoke name directly", () => {
        const input = 'Ответ < | DSML | invoke name="save_memory">< | DSML | parameter name="text">data</ | DSML | parameter>';
        expect(stripDSML(input)).toBe("Ответ");
    });

    it("strips antml tags", () => {
        const input = "Текст <function_calls>...";
        expect(stripDSML(input)).toBe("Текст");
    });

    it("strips partial DSML tag during streaming — < |", () => {
        expect(stripDSML("Ответ < |")).toBe("Ответ");
    });

    it("strips partial DSML tag — < | D", () => {
        expect(stripDSML("Ответ < | D")).toBe("Ответ");
    });

    it("strips partial DSML tag — < | DSM", () => {
        expect(stripDSML("Ответ < | DSM")).toBe("Ответ");
    });

    it("strips trailing < at end of text", () => {
        expect(stripDSML("Ответ <")).toBe("Ответ");
    });

    it("keeps < in middle of text", () => {
        expect(stripDSML("a < b is true")).toBe("a < b is true");
    });

    it("returns empty string for DSML-only input", () => {
        expect(stripDSML('< | DSML | function_calls>stuff</ | DSML | function_calls>')).toBe("");
    });

    it("handles empty input", () => {
        expect(stripDSML("")).toBe("");
    });
});
