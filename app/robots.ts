import type { MetadataRoute } from 'next';

/**
 * Grudge is a members-only fantasy league companion, not a searchable catalog.
 * Respectful crawlers should not traverse 20+ seasons, player profiles and
 * filtered reports, which otherwise trigger substantial server rendering.
 * Authentication and database RLS remain the actual access controls.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: '/' },
  };
}
