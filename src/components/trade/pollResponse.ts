import {HTTPSource, Response} from "@cycle/http";
import {Stream} from "xstream";

export const pollResponse = <T>(
    responses$: ReturnType<HTTPSource["select"]>,
    decode: (json: any, response: Response) => T | undefined,
): Stream<T> => responses$
    .map((response$) => response$
        .map((response) => decode(JSON.parse(response.text), response))
        .filter((result): result is T => result !== undefined)
        .replaceError(() => Stream.empty<T>()))
    .flatten();
