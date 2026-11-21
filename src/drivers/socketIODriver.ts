import { io, Socket } from "socket.io-client";
import Stream from "xstream";
import {credentialsChanged$, currentCredentialVersion} from "../credentials";
import {BoardLevels} from "../models/board";
import {Execution} from "../models/execution";
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

    private channels: { [channelName: string]: (message: any) => void } = {
        [`lightning_board_${productCode}`]: (message) => this.board$.shamefullySendNext(message),
        [`lightning_executions_${productCode}`]: (messages: Execution[]) => {
            this.executionBatch$.shamefullySendNext(messages);
            sendEach(this.execution$, messages);
        },
        child_order_events: (events) => sendEach(this.childOrderEvent$, events.filter(isTargetProduct)),
        parent_order_events: (events) => sendEach(this.parentOrderEvent$, events.filter(isTargetProduct)),
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

const isTargetProduct = (event: { product_code?: string }): boolean =>
    !event.product_code || event.product_code === productCode;
