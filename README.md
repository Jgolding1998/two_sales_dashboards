# Sales Dashboards for SyteLine

This repository contains a Node.js server and two HTML dashboards to display daily sales from Infor SyteLine/CSI. One dashboard uses order/ship dates while the other uses invoice dates. The server proxies API calls to your SyteLine environment and aggregates sales by Product, Service, Misc and Freight.

See `server.js` for configuration and `public/order.html` / `public/invoice.html` for the dashboards.
