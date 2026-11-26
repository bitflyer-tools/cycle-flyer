# FAQ and troubleshooting

## "Could not update credentials. Check that OS credential storage is available and try again."

Cycle Flyer stores your API key and secret through Electron's `safeStorage`,
which needs an OS-level secret store to encrypt them. On Linux this means a
keyring service must be available; without one, `safeStorage` only offers a
plaintext backend, and the [credential store](../srcElectron/credentials.js)
refuses to save or load credentials through it rather than write them
unencrypted. Install and run a keyring service (for example GNOME Keyring or
KWallet) for your desktop environment, then try saving your credentials
again.

## "Could not migrate legacy credentials. Enter your API key and secret to save them again."

Older versions of Cycle Flyer kept the API key and secret in the browser's
`localStorage`. On first launch after upgrading, the app tries to move that
pair into the OS credential store automatically. If OS credential storage is
unavailable at that moment, the migration fails, the legacy values are
discarded for security, and you see this message. Enter your API key and
secret in **Setting** again to save them through the OS credential store.

## An order shows "Unconfirmed" or "Unconfirmed (timed out)" in the history

This status means the app could not confirm whether bitFlyer accepted the
request: the network call to submit, cancel, or close the position failed or
timed out before a definitive response arrived. Unlike "✗" (the request was
rejected) or "○" (the request succeeded), "Unconfirmed" means the order may or
may not have been placed, modified, or canceled on bitFlyer's side. "(timed
out)" marks a request that passed bitFlyer's write deadline without a
response. Check your open orders and positions on bitFlyer directly (for
example on the bitFlyer web client) before retrying, to avoid sending a
duplicate order.

## An order was rejected — where is the reason?

When bitFlyer returns a definitive error for a submitted or canceled order,
the history entry is marked "✗". The underlying reason is the
`error_message` bitFlyer sent back (for example the order was below the
minimum size or the account lacked sufficient margin); see the
[order form reference](order-entry.md) for the size and validation rules the
app enforces before submitting.

## TWAP stopped before sending all of its slices

TWAP stops scheduling the remaining slices if a slice can't be signed (for
example because credentials were cleared or changed), if you leave **Trade**,
or if you change credentials while it's running. Slices already sent to
bitFlyer before that point can still execute even though later slices never
go out. Use **Cancel TWAP** to stop a schedule deliberately; see
[TWAP](order-entry.md#twap) for the full behavior.

## The order book looks frozen or out of date

The board resynchronizes from a REST snapshot whenever the socket connects or
disconnects, and also every 15 seconds regardless of connection state. If the
board doesn't seem to be updating, check your network connection; the
[Architecture](architecture.md#follow-an-order-book-update) document explains
how live updates and snapshots are combined.
