import { describe, it, expect } from "vitest";
import { parseDSMLCalls, hasDSML, extractTextBeforeDSML } from "../parseDSML";

describe("hasDSML", () => {
    it("returns true for DSML function_calls tag", () => {
        expect(hasDSML("text < | DSML | function_calls>")).toBe(true);
    });

    it("returns true for function_calls without DSML prefix", () => {
        expect(hasDSML("<function_calls>")).toBe(true);
    });

    it("returns false for normal text", () => {
        expect(hasDSML("Привет! Как дела?")).toBe(false);
    });

    it("returns false for empty string", () => {
        expect(hasDSML("")).toBe(false);
    });
});

describe("extractTextBeforeDSML", () => {
    it("extracts text before DSML block", () => {
        const input = 'Запомнил! < | DSML | function_calls>...';
        expect(extractTextBeforeDSML(input)).toBe("Запомнил!");
    });

    it("returns full text if no DSML", () => {
        expect(extractTextBeforeDSML("Просто текст")).toBe("Просто текст");
    });

    it("returns empty string if starts with DSML", () => {
        expect(extractTextBeforeDSML("< | DSML | function_calls>...")).toBe("");
    });
});

describe("parseDSMLCalls", () => {
    it("parses single invoke with parameters", () => {
        const input = `< | DSML | function_calls>
< | DSML | invoke name="create_zettel">
< | DSML | parameter name="title" string="true">Тест заметка</ | DSML | parameter>
< | DSML | parameter name="content" string="true">Контент заметки</ | DSML | parameter>
</ | DSML | invoke>
</ | DSML | function_calls>`;

        const calls = parseDSMLCalls(input);
        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe("create_zettel");
        expect(calls[0].params.title).toBe("Тест заметка");
        expect(calls[0].params.content).toBe("Контент заметки");
    });

    it("parses multiple invokes", () => {
        const input = `< | DSML | function_calls>
< | DSML | invoke name="save_memory">
< | DSML | parameter name="text" string="true">Факт</ | DSML | parameter>
</ | DSML | invoke>
< | DSML | invoke name="create_zettel">
< | DSML | parameter name="title" string="true">Заголовок</ | DSML | parameter>
</ | DSML | invoke>
</ | DSML | function_calls>`;

        const calls = parseDSMLCalls(input);
        expect(calls).toHaveLength(2);
        expect(calls[0].name).toBe("save_memory");
        expect(calls[1].name).toBe("create_zettel");
    });

    it("returns empty array for no DSML", () => {
        expect(parseDSMLCalls("Привет!")).toHaveLength(0);
    });

    it("returns empty array for empty string", () => {
        expect(parseDSMLCalls("")).toHaveLength(0);
    });
});
