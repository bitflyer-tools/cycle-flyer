import {HTTPSource, RequestInput, RequestOptions, Response} from "@cycle/http";
import {MainHTTPSource} from "@cycle/http/lib/cjs/MainHTTPSource";
import {createResponse$, optionsToSuperagent} from "@cycle/http/lib/cjs/http-driver";
import type {SuperAgentRequest} from "superagent";
import Stream from "xstream";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {currentCredentialVersion, signRest} from "../credentials";

export interface AccountRequest extends RequestOptions {
    credentialVersion?: number;
    cancelled?: () => boolean;
}

export const isCurrentAccountRequest = (request: Pick<AccountRequest, "credentialVersion"> | undefined): boolean =>
    request?.credentialVersion !== undefined && request.credentialVersion === currentCredentialVersion();

export const unsignedRequests$ = Stream.create<RequestInput>();

export const makeSignedHTTPDriver = () => {
    const driver = makeHTTPDriver();
    return (requests$: Stream<RequestInput | null>, name?: string) => driver(
        requests$
            .map((request) => Stream.fromPromise(authorizeRequest(request).then((authorized) => {
                const accountRequest = authorized as AccountRequest | null;
                const stale = accountRequest?.credentialVersion !== undefined && !isCurrentAccountRequest(accountRequest);
                if (request && (!authorized || stale)) { unsignedRequests$.shamefullySendNext(request); }
                return stale ? null : authorized;
            })))
            .compose(flattenConcurrently),
        name,
    );
};

export const authorizeRequest = async (request: RequestInput | null): Promise<RequestInput | null> => {
    const origin = "https://api.bitflyer.jp";
    if (!request || typeof request === "string" || !request.url.startsWith(origin + "/v1/me/")) {
        return request;
    }

    const version = currentCredentialVersion();
    const expectedVersion = (request as AccountRequest).credentialVersion;
    if (version === null) { return null; }
    const cancelled = () => version !== currentCredentialVersion()
        || (expectedVersion !== undefined && expectedVersion !== version)
        || (request as AccountRequest).cancelled?.() === true;
    if (cancelled()) { return null; }

    try {
        const body = request.send || "";
        const headers = typeof body === "string"
            ? await signWithDeadline(request.method || "GET", request.url.slice(origin.length), body)
            : null;
        if (!cancelled() && headers) {
            const authorized: AccountRequest = {
                ...request,
                credentialVersion: version,
                headers: Object.assign({}, request.headers, headers),
            };
            return authorized;
        }
    } catch {
        // eslint-disable-next-line no-console
        console.error("Unable to sign the bitFlyer request.");
    }
    return null;
};

const signingDeadlineMs = 15_000;
const requestDeadlineMs = 10_000;
const pollDeadlineMs = 15_000;
const periodicReadCategories = new Set(["orders", "positions", "collateral", "status"]);

export const makeHTTPDriver = (deadlineMs = requestDeadlineMs) =>
    (requests$: Stream<RequestInput | null>, name = "HTTP"): HTTPSource => {
        const responses$ = requests$
            .filter((input): input is RequestInput => input !== null)
            .map((input) => responseStream(typeof input === "string" ? { url: input } : input, deadlineMs));
        responses$.addListener({});
        return new MainHTTPSource(responses$, name);
    };

export const isWriteDeadlineError = (error: any): boolean =>
    error?.code === "ECONNABORTED" && error.errno === "ETIME";

const signWithDeadline = async (method: string, path: string, body: string) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), signingDeadlineMs);
    });
    try {
        return await Promise.race([signRest(method, path, body), expiry]);
    } finally {
        clearTimeout(timeout);
    }
};

const responseStream = (options: RequestOptions, deadlineMs: number) => {
    const method = options.method?.toUpperCase() ?? "GET";
    const isWrite = method === "POST";
    const isPeriodicRead = method === "GET" && periodicReadCategories.has(options.category ?? "");
    const deadline = isWrite || options.category === "executions" || options.category === "recent-trades"
        ? deadlineMs
        : isPeriodicRead ? pollDeadlineMs : undefined;
    const response$ = deadline === undefined ? createResponse$(options) : responseWithDeadline(options, deadline);
    const remembered$ = Object.assign(response$.remember(), { request: options });
    if (!options.lazy || isWrite) remembered$.addListener({});
    return remembered$;
};

const responseWithDeadline = (options: RequestOptions, deadlineMs: number): Stream<Response> =>
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
