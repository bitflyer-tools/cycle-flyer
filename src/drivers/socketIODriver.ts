import { io, Socket } from "socket.io-client";
import Stream from "xstream";
import {credentialsChanged$, currentCredentialVersion} from "../credentials";
import {BoardLevels, isBoardLevels} from "../models/board";
import {Execution, isExecution} from "../models/execution";
import {ChildOrderEvent, ParentOrderEvent} from "../models/orderEvent";
import {authenticate, privateChannelNames} from "./privateChannel";

export const makeSocketIODriver = () => (): SocketIOSource => {
    const serverURL = "https://io.lightstream.bitflyer.com";
    const options = { transports: ["websocket"] };
    return new SocketIOSource(io(serverURL, options));
};

const productCode = "FX_BTC_JPY";

export class SocketIOSource {
    public board$: Stream<BoardLevels> = Stream.create();
    public ticker$: Stream<object> = Stream.create();
    public execution$: Stream<Execution> = Stream.create();
    public executionBatch$: Stream<Execution[]> = Stream.create();
    public childOrderEvent$: Stream<ChildOrderEvent> = Stream.create();
    public connected$: Stream<boolean>;
    public reconnect$: Stream<null> = Stream.create();
    public parentOrderEvent$: Stream<ParentOrderEvent> = Stream.create();

    private channels: { [channelName: string]: (message: unknown) => void } = {
        [`lightning_board_${productCode}`]: (message: unknown) => {
            if (isBoardLevels(message)) { this.board$.shamefullySendNext(message); }
        },
        [`lightning_executions_${productCode}`]: (message: unknown) => {
            if (!Array.isArray(message)) { return; }
            const executions = message.filter(isExecution);
            if (executions.length === 0) { return; }
            this.executionBatch$.shamefullySendNext(executions);
            sendEach(this.execution$, executions);
        },
        child_order_events: (message) => sendOrderEvents(this.childOrderEvent$, message),
        parent_order_events: (message) => sendOrderEvents(this.parentOrderEvent$, message),
    };

    constructor(client: Socket) {
        const publicChannelNames = Object.keys(this.channels).filter((name) => privateChannelNames.indexOf(name) < 0);

        this.connected$ = Stream.createWithMemory<boolean>({
            start: (listener) => listener.next(client.connected),
            stop: () => undefined,
        });
        client.on("disconnect", () => this.connected$.shamefullySendNext(false));

        let authenticatedVersion: number | null = null;
        let connectedOnce = false;
        client.on("connect", () => {
            authenticatedVersion = null;
            publicChannelNames.forEach((channelName) => client.emit("subscribe", channelName));
            const version = currentCredentialVersion();
            authenticate(client, () => {
                if (version === null || version !== currentCredentialVersion()) { return; }
                authenticatedVersion = version;
                privateChannelNames.forEach((channelName) => client.emit("subscribe", channelName));
            });
            this.connected$.shamefullySendNext(true);
            if (connectedOnce) { this.reconnect$.shamefullySendNext(null); }
            connectedOnce = true;
        });

        credentialsChanged$.addListener({
            next: () => { client.disconnect().connect(); },
        });

        Object.keys(this.channels).forEach((channelName) => {
            const receive = this.channels[channelName];
            client.on(channelName, (message) => {
                if (publicChannelNames.includes(channelName)
                    || (authenticatedVersion !== null && authenticatedVersion === currentCredentialVersion())) {
                    receive(message);
                }
            });
        });
    }
}

const sendEach = <T>(stream: Stream<T>, messages: T[]) =>
    messages.forEach((message) => stream.shamefullySendNext(message));

const sendOrderEvents = <T extends ChildOrderEvent | ParentOrderEvent>(stream: Stream<T>, message: unknown) => {
    if (!Array.isArray(message)) { return; }
    sendEach(stream, message.filter(isTargetProduct));
};

const isTargetProduct = (event: unknown): boolean => {
    if (event === null || typeof event !== "object" || Array.isArray(event)) { return false; }
    const { product_code } = event as { product_code?: unknown };
    return !product_code || product_code === productCode;
};
