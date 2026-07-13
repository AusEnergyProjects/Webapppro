This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Comparison routes

- `/compare` is the primary typed electricity comparer.
- `/compare/electricity-next` is a noindex native regression route.
- `/compare/electricity-legacy` preserves the compatibility implementation as a noindex rollback path.
- `/gas-compare` is the gas comparer.

## Local enquiry delivery

The comparer submits result emails and upgrade enquiries to the same-origin `/api/leads` route. Configure the downstream processor in an ignored `.env.local` file:

```text
AEA_LEAD_WEBHOOK_URL=https://your-private-lead-processor.example/endpoint
```

Do not expose this value through a `NEXT_PUBLIC_` variable. The route validates the request, checks consent evidence, applies a best-effort local rate limit, and only reports success after the downstream processor returns a successful response. A production launch should replace the in-memory rate limit with a durable shared limiter.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
