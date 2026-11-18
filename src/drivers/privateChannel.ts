import {Socket} from "socket.io-client";
import {signRealtime} from "../credentials";

export const privateChannelNames = ["child_order_events", "parent_order_events"];

export const authenticate = async (client: Socket, onAuthenticated: () => void): Promise<void> => {
    const connectionId = client.id;
    try {
        const params = await signRealtime();
        if (!params || !client.connected || client.id !== connectionId) { return; }

        client.emit("auth", params, (error: any) => {
            if (!error && client.connected && client.id === connectionId) {
                onAuthenticated();
            }
        });
    } catch {
        // eslint-disable-next-line no-console
        console.error("Unable to sign bitFlyer private-channel authentication.");
    }
};
