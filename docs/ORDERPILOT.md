# OrderPilot

OrderPilot is a separate post-order support workspace within the existing Live HQ Cloudflare Worker project.

## Route
- `/orderpilot` — OrderPilot MVP workspace.
- `/admin` remains the existing Live HQ administration route and is not replaced.

## MVP scope
- Overview dashboard and action queue
- Customer case capture, search and status filtering
- Delivery follow-up list
- Returns and complaints list
- Basic service snapshot and CSV export
- Responsive desktop and mobile layout

## Current limitations — demo only
This first UI prototype uses fictional sample records held in browser memory. Changes reset on refresh. It has no retailer login, tenant isolation, durable database, courier/shop integrations, email/SMS sending, or real customer data. Do not enter personal information or use it for live customer support.

## Production readiness sequence
1. Confirm the Cloudflare Pages/Worker routing and deployment target.
2. Provision a database (Cloudflare D1) and bind it to the existing deployment.
3. Implement retailer authentication, tenant-scoped authorization and audit logging.
4. Add validated API endpoints for cases, orders, delivery events and returns.
5. Add integrations only with retailer authorization and documented API access.
6. Add human approval before any customer communication.
7. Test tenant isolation, access controls, privacy retention and backups before live use.
