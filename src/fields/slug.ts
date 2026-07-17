import { slugField, ValidationError, type RowField } from 'payload'

const slugifyStableURL = ({ valueToSlugify }: { valueToSlugify?: unknown }): string | undefined => {
  if (typeof valueToSlugify !== 'string') {
    return undefined
  }

  const slug = valueToSlugify
    .normalize('NFKD')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || undefined
}

export const stableSlugField = (useAsSlug = 'title'): RowField =>
  slugField({
    localized: false,
    overrides: (field) => {
      const generateSlug = field.fields[0]

      if (generateSlug?.type === 'checkbox') {
        generateSlug.defaultValue = false
      }

      const slug = field.fields[1]

      if (slug?.type === 'text') {
        slug.admin = {
          ...slug.admin,
          description:
            'Stable URL slug shared by all locales. Use Latin letters, numbers, and hyphens.',
        }
        slug.validate = (value: unknown) => {
          if (typeof value !== 'string' || value.length === 0) {
            return 'A stable slug is required, including for drafts.'
          }

          return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
            ? true
            : 'Use lowercase Latin letters, numbers, and single hyphens only.'
        }
        slug.hooks = {
          ...slug.hooks,
          beforeValidate: [
            ...(slug.hooks?.beforeValidate ?? []),
            ({ collection, operation, previousValue, req, siblingData, value }) => {
              const source =
                typeof value === 'string' && value.length > 0
                  ? value
                  : operation === 'update' && typeof previousValue === 'string'
                    ? previousValue
                    : siblingData[useAsSlug]
              const stableSlug = slugifyStableURL({ valueToSlugify: source })

              if (!stableSlug) {
                throw new ValidationError({
                  collection: collection?.slug,
                  errors: [
                    {
                      message: 'A stable Latin-character slug is required for every locale.',
                      path: 'slug',
                    },
                  ],
                  req,
                })
              }

              return stableSlug
            },
          ],
        }
      }

      return field
    },
    slugify: slugifyStableURL,
    useAsSlug,
  })
