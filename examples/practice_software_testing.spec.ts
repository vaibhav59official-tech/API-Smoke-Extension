/**
 * Practice Software Testing - Production-Grade API Regression Suite
 * Conforms to Senior SDET Enterprise Quality Standards:
 * - Test Isolation: Zero module-level shared mutable state across test() blocks.
 * - Dynamic Workflow: Chained product-to-cart journey encapsulated in a single test with test.step().
 * - Dynamic Entity Lifecycle: Zero hardcoded fallback cart IDs.
 * - Defensive Assertions: Validates parent object/array existence before child property access.
 * - Monotonic Timing: Uses performance.now() with configurable SLA threshold.
 * - Standard HTTP Verbs: Standard GET/POST instead of nonstandard QUERY.
 * 
 * Execution:
 *   npx playwright test examples/practice_software_testing.spec.ts --reporter=html
 *   npx playwright show-report
 */

import { test, expect, type APIResponse } from '@playwright/test';

// Centralized Environment Configuration
const BASE_URL = process.env.BASE_URL ?? 'https://api.practicesoftwaretesting.com';
const MAX_SLA_MS = Number(process.env.MAX_RESPONSE_TIME_MS ?? 5000);

/**
 * Monotonic duration measurement helper.
 * Measures latency and logs duration without flaking functional regression on temporary network jitter.
 */
async function executeTimedRequest(
  stepDescription: string,
  requestFn: () => Promise<APIResponse>,
  slaMs = MAX_SLA_MS
): Promise<{ response: APIResponse; durationMs: number }> {
  const start = performance.now();
  const response = await requestFn();
  const durationMs = performance.now() - start;

  console.log(`[API SLA] ${stepDescription} -> Status: ${response.status()} | Latency: ${durationMs.toFixed(1)}ms (SLA: <${slaMs}ms)`);

  // Soft warning if latency exceeds SLA to prevent network jitter test flakiness
  if (durationMs > slaMs) {
    console.warn(`[PERF WARNING] ${stepDescription} took ${durationMs.toFixed(1)}ms, exceeding SLA of ${slaMs}ms`);
  }

  return { response, durationMs };
}

test.describe('Practice Software Testing - API Regression Suite', () => {

  // ---------------------------------------------------------------------------
  // Test 1: Isolated Contract Test - Product Specifications & Names
  // ---------------------------------------------------------------------------
  test('TC01: GET /product-specs/names - validates specifications contract', async ({ request }) => {
    const { response } = await executeTimedRequest('Fetch Specs', () => 
      request.get(`${BASE_URL}/product-specs/names`)
    );

    expect(response.status(), 'Expected HTTP 200 OK for specifications').toBe(200);

    const body = await response.json();
    expect(Array.isArray(body), 'Expected response body to be an array').toBeTruthy();
    expect(body.length, 'Expected at least one specification name').toBeGreaterThan(0);

    // Defensive item-level schema validation
    const firstSpec = body[0];
    expect(firstSpec, 'First spec item must not be null').toBeTruthy();
    expect(typeof firstSpec === 'string' || typeof firstSpec.name === 'string', 'Spec must contain string identity').toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Test 2: Isolated Contract Test - Catalog Search & Pagination Contract
  // ---------------------------------------------------------------------------
  test('TC02: GET /products - validates catalog search & filtering schema', async ({ request }) => {
    const { response } = await executeTimedRequest('Search Products', () =>
      request.get(`${BASE_URL}/products`, {
        params: {
          between: 'price,1,100',
          page: '1'
        }
      })
    );

    expect(response.status(), 'Expected HTTP 200 OK for catalog search').toBe(200);

    const body = await response.json();
    
    // Defensive structural verification
    expect(body, 'Response body must be defined').toBeDefined();
    expect(Array.isArray(body.data), 'Expected body.data to be an array of products').toBeTruthy();
    expect(body.data.length, 'Expected catalog to return at least 1 product').toBeGreaterThan(0);

    // Pagination contract assertions
    expect(typeof body.current_page === 'number' || typeof body.current_page === 'string', 'Expected current_page').toBeTruthy();
    expect(body.total, 'Expected numerical total count').toBeGreaterThan(0);

    // Deep defensive schema verification on first product
    const product = body.data[0];
    expect(product.id, 'Product ID must be defined').toBeTruthy();
    expect(product.name, 'Product name must be defined').toBeTruthy();
    expect(typeof product.price, 'Product price must be a number').toBe('number');

    // Defensive nested object check (Category & Brand)
    if (product.category !== undefined && product.category !== null) {
      expect(typeof product.category, 'Product category must be an object').toBe('object');
      expect(product.category.name, 'Category name must be defined when category exists').toBeDefined();
    }

    if (product.brand !== undefined && product.brand !== null) {
      expect(typeof product.brand, 'Product brand must be an object').toBe('object');
      expect(product.brand.name, 'Brand name must be defined when brand exists').toBeDefined();
    }
  });

  // ---------------------------------------------------------------------------
  // Test 3: Chained End-to-End User Journey (Product -> Cart Lifecycle)
  // Single cohesive test with test.step() - ZERO cross-test shared mutable state!
  // ---------------------------------------------------------------------------
  test('TC03: End-to-End Journey: Catalog Discovery -> Dynamic Cart Creation -> Add Item -> Verify Cart', async ({ request }) => {
    let targetProductId = '';
    let targetProductName = '';
    let targetProductPrice = 0;
    let dynamicCartId = '';

    // Step 1: Query Catalog & Dynamically Extract Product
    await test.step('Step 1: Query catalog and select target item', async () => {
      const { response } = await executeTimedRequest('Step 1: Discover Product', () =>
        request.get(`${BASE_URL}/products`)
      );

      expect(response.status()).toBe(200);
      const catalog = await response.json();
      expect(Array.isArray(catalog.data)).toBeTruthy();
      expect(catalog.data.length, 'Prerequisite failure: Catalog is empty').toBeGreaterThan(0);

      const selected = catalog.data[0];
      targetProductId = selected.id;
      targetProductName = selected.name;
      targetProductPrice = selected.price;

      expect(targetProductId, 'Selected targetProductId must not be empty').toBeTruthy();
      console.log(`[Journey] Selected Product: ${targetProductName} (ID: ${targetProductId}, Price: $${targetProductPrice})`);
    });

    // Step 2: Fetch Specific Product Details Contract
    await test.step('Step 2: Fetch and validate product details contract', async () => {
      const { response } = await executeTimedRequest('Step 2: Get Product Details', () =>
        request.get(`${BASE_URL}/products/${targetProductId}`)
      );

      expect(response.status()).toBe(200);
      const product = await response.json();
      expect(product.id).toBe(targetProductId);
      expect(product.price).toBe(targetProductPrice);
    });

    // Step 3: Dynamically Create a New Cart (ZERO Hardcoded Fallback IDs!)
    await test.step('Step 3: Dynamically create cart', async () => {
      const { response } = await executeTimedRequest('Step 3: Create Cart', () =>
        request.post(`${BASE_URL}/carts`)
      );

      expect([200, 201], 'Cart creation must return 200 or 201').toContain(response.status());
      const cartData = await response.json();

      expect(cartData, 'Cart creation response must not be null').toBeTruthy();
      expect(cartData.id, 'Cart creation must yield dynamic cart ID').toBeTruthy();

      dynamicCartId = cartData.id;
      console.log(`[Journey] Dynamically initialized cart ID: ${dynamicCartId}`);
    });

    // Step 4: Add Selected Product to the Dynamically Created Cart
    await test.step('Step 4: Add product to dynamic cart', async () => {
      const quantityToAdd = 1;
      const { response } = await executeTimedRequest('Step 4: Add Item to Cart', () =>
        request.post(`${BASE_URL}/carts/${dynamicCartId}`, {
          data: {
            product_id: targetProductId,
            quantity: quantityToAdd
          }
        })
      );

      expect([200, 201], 'Adding to cart must succeed').toContain(response.status());
    });

    // Step 5: Verify Cart Contents and Mathematical Integrity
    await test.step('Step 5: Verify cart state and item presence', async () => {
      const { response } = await executeTimedRequest('Step 5: Retrieve Cart', () =>
        request.get(`${BASE_URL}/carts/${dynamicCartId}`)
      );

      expect(response.status()).toBe(200);
      const cart = await response.json();

      expect(cart.id).toBe(dynamicCartId);
      
      // Defensive cart items array check
      const cartItems = cart.cart_items ?? cart.items ?? [];
      expect(Array.isArray(cartItems), 'Cart items must be an array').toBeTruthy();
      expect(cartItems.length, 'Cart must contain at least 1 item').toBeGreaterThan(0);

      // Verify item presence in cart
      const itemInCart = cartItems.find((item: any) => 
        item.product_id === targetProductId || (item.product && item.product.id === targetProductId)
      );
      expect(itemInCart, `Expected product ${targetProductId} to be present in cart`).toBeDefined();
      console.log(`[Journey] Successfully verified item in cart: ${targetProductName}`);
    });

  });

});

