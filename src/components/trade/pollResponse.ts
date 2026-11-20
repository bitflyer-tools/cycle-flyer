import {HTTPSource, Response} from "@cycle/http";
import {Stream} from "xstream";
import flattenConcurrently from "xstream/extra/flattenConcurrently";

export const pollResponse = <T>(
    responses$: ReturnType<HTTPSource["select"]>,
    decode: (json: any, response: Response) => T | undefined,
): Stream<T> => {
    let nextRequest = 0;
    let latestApplied = 0;

    return responses$
        .map((response$) => {
            const request = ++nextRequest;
            return response$
                .map((response) => decode(JSON.parse(response.text), response))
                .filter((result): result is T => result !== undefined)
                .map((result) => ({ request, result }))
                .replaceError(() => Stream.empty());
        })
        .compose(flattenConcurrently)
        .filter(({ request }) => {
            if (request <= latestApplied) { return false; }
            latestApplied = request;
            return true;
        })
        .map(({ result }) => result);
};
