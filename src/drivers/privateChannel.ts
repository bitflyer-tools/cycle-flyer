import {Socket} from "socket.io-client";
import {currentCredentialVersion, signRealtime} from "../credentials";

export const privateChannelNames = ["child_order_events", "parent_order_events"];

export const authAckDeadlineMs = 10_000;
export const authRetryDelaysMs = [1_000, 2_000, 5_000, 10_000];

export const authenticate = async (client: Socket, onAuthenticated: () => void): Promise<void> => {
    const connectionId = client.id;
    const version = currentCredentialVersion();
    if (version === null) { return; }
    const isCurrent = () => client.connected && client.id === connectionId && version === currentCredentialVersion();

    const attempt = async (retryCount: number): Promise<void> => {
        if (!isCurrent()) { return; }
        return signRealtime().then((params) => {
            if (!params || !isCurrent()) { return; }
            let settled = false;
            const deadline = setTimeout(() => {
                settled = true;
                retry(retryCount);
            }, authAckDeadlineMs);
            client.emit("auth", params, (error: any) => {
                if (settled) { return; }
                settled = true;
                clearTimeout(deadline);
                if (!isCurrent()) { return; }
                if (!error) {
                    onAuthenticated();
                    return;
                }
                retry(retryCount);
            });
        }).catch(() => {
            // eslint-disable-next-line no-console
            console.error("Unable to sign bitFlyer private-channel authentication.");
            retry(retryCount);
        });
    };

    const retry = (retryCount: number): void => {
        if (!isCurrent()) { return; }
        const delay = authRetryDelaysMs[Math.min(retryCount, authRetryDelaysMs.length - 1)];
        setTimeout(() => attempt(retryCount + 1), delay);
    };

    return attempt(0);
};
