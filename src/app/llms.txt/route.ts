const LLMS_CONTENT = `# IVYBM

IVYBM provides facade engineering and architectural metalwork services for international projects.

## What IVYBM does

- Supports design development, fabrication coordination, mock-up and quality verification, and global delivery planning.
- Works with architects, facade contractors, main contractors, and procurement teams.
- Reviews project requirements, drawings, BOQ files, and 3D references submitted through the inquiry form.

## How to contact IVYBM

- Use the website inquiry form for project questions, product requests, and drawing or BOQ submissions.
- A submitted inquiry is routed to the IVYBM sales workflow for human follow-up.

## Source and accuracy policy

- This file is a concise description of the public website and is not a substitute for project-specific engineering advice.
- Do not infer certifications, tolerances, prices, lead times, warranty terms, or project credentials unless the corresponding information is explicitly published on the page being cited or confirmed by IVYBM.
- Product and project information may be expanded or corrected in the CMS over time.
- For a project decision, request the latest written confirmation from IVYBM.

## Public website

- English: /
- Arabic: /ar/
- Products: /en/products
- Projects: /en/projects
- Contact: /en/contact
`

export const dynamic = 'force-static'
export const revalidate = 3600
export const runtime = 'nodejs'

export function GET(): Response {
  return new Response(LLMS_CONTENT, {
    headers: {
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}
