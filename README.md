# cycle-flyer

[![CI](https://github.com/bitflyer-tools/cycle-flyer/actions/workflows/ci.yml/badge.svg)](https://github.com/bitflyer-tools/cycle-flyer/actions/workflows/ci.yml)
[![Libraries.io dependency status for GitHub repo](https://img.shields.io/librariesio/github/bitflyer-tools/cycle-flyer.svg)](https://libraries.io/github/bitflyer-tools/cycle-flyer)
![GitHub](https://img.shields.io/github/license/bitflyer-tools/cycle-flyer.svg)

## Download

Download the latest release from [GitHub Releases](https://github.com/bitflyer-tools/cycle-flyer/releases).

![](./images/looking.png)

## Features

- Follow the live `FX_BTC_JPY` order book and spread, with adjustable price grouping.
- View collateral, positions, and profit or loss with bitFlyer Lightning API credentials.
- Place market, limit, stop, and ranged IFDOCO orders.
- Use TWAP to split a market order into slices submitted at a set interval.

## Quick start

1. Download the installer or archive for your platform from [GitHub Releases](https://github.com/bitflyer-tools/cycle-flyer/releases/latest).
2. Follow the instructions for your platform.
   - **Windows** — Run the Setup executable.
   - **macOS (Apple Silicon, `arm64`)** — Extract the ZIP.
   - **Linux (x86-64)** — Install the `.deb` (`amd64`) or `.rpm` (`x86_64`) package for your distribution.
3. Open Cycle Flyer. On the **Trade** screen, check the bid and ask prices and the spread in the order book. Use **−** and **+** next to **Group** to adjust the price grouping.

You can view the order book without an API key.

### Optional: View account information

1. Open **Setting** and enter your bitFlyer Lightning credentials in **API Key** and **API Secret**. Use an API key with read permissions for collateral, positions, and orders.
2. Return to **Trade** to check your account summary, including collateral and position information. You can verify access without placing an order.

## Tests

Run `npm run lint` to run the same ESLint check as CI. The check fails on warnings as well as errors.

With Node.js 24, run `npm ci` and then `npm run test:coverage` to run the full test suite and print the coverage report.

## Author

[@unhappychoice](https://unhappychoice.com)
