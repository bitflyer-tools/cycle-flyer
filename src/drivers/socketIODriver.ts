import { io, Socket } from "socket.io-client";
import Stream from "xstream";
import {ChildOrderEvent, ParentOrderEvent} from "../models/orderEvent";
import {authenticate, privateChannelNames} from "./privateChannel";

export const makeSocketIODriver = () => (): SocketIOSource => {
    const serverURL = "https://io.lightstream.bitflyer.com";
    const options = { transports: ["websocket"] };
    return new SocketIOSource(io(serverURL, options));
};

const productCode = "FX_BTC_JPY";

export class SocketIOSource {
    public boardSnapshot$: Stream<object> = Stream.create();
    public board$: Stream<object> = Stream.create();
    public ticker$: Stream<object> = Stream.create();
    public execution$: Stream<object> = Stream.create();
    public childOrderEvent$: Stream<ChildOrderEvent> = Stream.create();
    public parentOrderEvent$: Stream<ParentOrderEvent> = Stream.create();

    private channels: { [channelName: string]: (message: any) => void } = {
        [`lightning_board_snapshot_${productCode}`]: (message) => this.boardSnapshot$.shamefullySendNext(message),
        [`lightning_board_${productCode}`]: (message) => this.board$.shamefullySendNext(message),
        [`lightning_executions_${productCode}`]: (messages) => sendEach(this.execution$, messages),
        child_order_events: (events) => sendEach(this.childOrderEvent$, events.filter(isTargetProduct)),
        parent_order_events: (events) => sendEach(this.parentOrderEvent$, events.filter(isTargetProduct)),
    };

    constructor(client: Socket) {
        const publicChannelNames = Object.keys(this.channels).filter((name) => privateChannelNames.indexOf(name) < 0);

        client.on("connect", () => {
            publicChannelNames.forEach((channelName) => client.emit("subscribe", channelName));
            authenticate(client, () => privateChannelNames.forEach((channelName) => client.emit("subscribe", channelName)));
        });

        Object.keys(this.channels).forEach((channelName) => client.on(channelName, this.channels[channelName]));
    }
}

const sendEach = <T>(stream: Stream<T>, messages: T[]) =>
    messages.forEach((message) => stream.shamefullySendNext(message));

const isTargetProduct = (event: { product_code?: string }): boolean =>
    !event.product_code || event.product_code === productCode;
