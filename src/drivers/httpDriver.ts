import {HTTPSource, RequestInput, RequestOptions, Response} from "@cycle/http";
import {MainHTTPSource} from "@cycle/http/lib/cjs/MainHTTPSource";
import {createResponse$, optionsToSuperagent} from "@cycle/http/lib/cjs/http-driver";
import type {SuperAgentRequest} from "superagent";
import Stream from "xstream";

const writeDeadlineMs = 10_000;

export const makeHTTPDriver = (deadlineMs = writeDeadlineMs) =>
    (requests$: Stream<RequestInput | null>, name = "HTTP"): HTTPSource => {
        const responses$ = requests$
            .filter((input): input is RequestInput => input !== null)
            .map((input) => responseStream(typeof input === "string" ? { url: input } : input, deadlineMs));
        responses$.addListener({});
        return new MainHTTPSource(responses$, name);
    };

export const isWriteDeadlineError = (error: any): boolean =>
    error?.code === "ECONNABORTED" && error.errno === "ETIME";

const responseStream = (options: RequestOptions, deadlineMs: number) => {
    const isWrite = options.method?.toUpperCase() === "POST";
    const response$ = isWrite
        ? writeResponse(options, deadlineMs)
        : createResponse$(options);
    const remembered$ = Object.assign(response$.remember(), { request: options });
    if (!options.lazy || isWrite) remembered$.addListener({});
    return remembered$;
};

const writeResponse = (options: RequestOptions, deadlineMs: number): Stream<Response> =>
    Stream.fromPromise(new Promise<Response>((resolve, reject) => {
        const request: SuperAgentRequest = optionsToSuperagent(options);
        request.timeout({ deadline: deadlineMs }).end((error, response) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(Object.assign(response, { request: options }));
        });
    }));
