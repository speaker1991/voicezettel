import { z } from "zod";

export const CounterTypeSchema = z.enum(["ideas", "facts", "persons", "tasks"]);
export type CounterType = z.infer<typeof CounterTypeSchema>;

export interface FlyingAnimation {
    id: string;
    counterType: CounterType;
}
