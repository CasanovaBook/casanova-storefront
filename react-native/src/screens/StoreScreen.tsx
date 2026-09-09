/* ─────────────────────────────────────────────────────────────
 * StoreScreen — browse only.
 *
 * Purchase happens on the website, not here. That is a deliberate
 * decision rather than an unfinished feature:
 *
 *  - Both apps read the same `products`, `orders` and `user_products`
 *    tables, so a checkout completed in a browser appears in this
 *    library the next time it refreshes. There is nothing to synchronise
 *    and no second source of truth.
 *  - Taking payment inside an iOS app for digital content read inside
 *    that app requires In-App Purchase under the App Store rules, which
 *    is a different product decision from the one the web storefront
 *    made. Silently routing around it would get the build rejected.
 *
 * What this screen does provide is the catalogue with honest prices, so
 * a reader who discovers a title in the app is one tap from buying it
 * instead of having to remember to open a browser later.
 * ───────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from "react"

import {
  Image,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import {
  Body,
  Button,
  Card,
  EmptyState,
  Notice,
  Screen,
  Title,
} from "../components/ui"

import { fetchCatalog } from "../net/api"

import type { CatalogProduct } from "../net/types"

import { effectivePrice } from "../net/types"

import { useAuth } from "../store/AuthContext"

import { colors, fontSize, radius, spacing } from "../theme"

/** Deep link into the web storefront's checkout for one product. */

function checkoutUrl(slug: string): string {
  return `https://casanova.example/store/${encodeURIComponent(slug)}`
}

export function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("he-IL", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    /* `Intl` with a currency style is not guaranteed on every Hermes
     * build. A plain number with the code is ugly but never wrong. */

    return `${amount} ${currency}`
  }
}

export function StoreScreen() {
  const { settings } = useAuth()

  const [products, setProducts] = useState<CatalogProduct[]>([])

  const [loading, setLoading] = useState(true)

  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)

    const result = await fetchCatalog()

    setLoading(false)

    if (!result.ok) {
      setError(result.error)

      return
    }

    setError(null)

    setProducts(result.data)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void load()}
            tintColor={colors.primary}
          />
        }
      >
        <Title size="lg">החנות</Title>
        <Body muted>הקטלוג המלא, אותו מחיר ואותה ספרייה כמו באתר.</Body>

        <Notice tone="info" title="הרכישה מתבצעת באתר">
          לחיצה על פריט פותחת את עמוד הרכישה באתר. מיד לאחר התשלום הספר מופיע
          בספרייה כאן, בלי לבצע התחברות נוספת.
        </Notice>

        {error ? <Notice tone="warn">{error}</Notice> : null}

        {!loading && products.length === 0 && !error ? (
          <EmptyState
            title="הקטלוג ריק"
            message="עדיין לא פורסמו פריטים בחנות."
          />
        ) : null}

        {products.map((product) => {
          const price = effectivePrice(product)

          const onSale =
            typeof product.sale_price === "number" &&
            product.sale_price < product.price

          const currency = product.currency || settings.default_currency

          return (
            <Card key={product.product_id} style={styles.row}>
              <View style={styles.coverWrap}>
                {product.image_url ? (
                  <Image
                    source={{ uri: product.image_url }}
                    style={styles.cover}
                    resizeMode="cover"
                  />
                ) : (
                  <View
                    style={[
                      styles.cover,
                      styles.coverFallback,
                      {
                        backgroundColor:
                          product.cover_colors?.[0] ?? colors.surfaceRaised,
                      },
                    ]}
                  >
                    <Text style={styles.coverFallbackText}>
                      {product.name.slice(0, 1)}
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.rowBody}>
                <Text numberOfLines={2} style={styles.rowTitle}>
                  {product.name}
                </Text>
                {product.book?.author_name ? (
                  <Text numberOfLines={1} style={styles.rowAuthor}>
                    {product.book.author_name}
                  </Text>
                ) : null}
                {product.short_description ? (
                  <Text numberOfLines={2} style={styles.rowDescription}>
                    {product.short_description}
                  </Text>
                ) : null}

                <View style={styles.priceRow}>
                  <Text style={styles.price}>
                    {formatPrice(price, currency)}
                  </Text>
                  {onSale ? (
                    <Text style={styles.oldPrice}>
                      {formatPrice(product.price, currency)}
                    </Text>
                  ) : null}
                </View>

                <Button
                  label="לרכישה באתר"
                  variant="ghost"
                  style={styles.buyButton}
                  onPress={() =>
                    void Linking.openURL(checkoutUrl(product.slug)).catch(
                      () => undefined,
                    )
                  }
                />
              </View>
            </Card>
          )
        })}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },

  row: { flexDirection: "row", gap: spacing.md },

  coverWrap: { width: 74 },

  cover: {
    width: 74,

    height: 104,

    borderRadius: radius.sm,

    backgroundColor: colors.surfaceRaised,

    overflow: "hidden",
  },

  coverFallback: { alignItems: "center", justifyContent: "center" },

  coverFallbackText: {
    color: colors.foreground,
    fontSize: fontSize.xxl,
    fontWeight: "700",
  },

  rowBody: { flex: 1 },

  rowTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "600",
    writingDirection: "rtl",
  },

  rowAuthor: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: 2,
    writingDirection: "rtl",
  },

  rowDescription: {
    color: colors.muted,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
    lineHeight: 17,
    writingDirection: "rtl",
  },

  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },

  price: { color: colors.primary, fontSize: fontSize.lg, fontWeight: "700" },

  oldPrice: {
    color: colors.muted,
    fontSize: fontSize.sm,
    textDecorationLine: "line-through",
  },

  buyButton: { marginTop: spacing.md, alignSelf: "flex-start" },
})

export default StoreScreen
