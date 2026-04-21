"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import {
  addToCart as apiAdd,
  getCart as apiGet,
  updateCartItem as apiUpdate,
  removeCartItem as apiRemove,
  clearCart as apiClear,
  type Cart,
  type CartItem,
} from "./api";

const STORAGE_KEY = "oemline-cart-key";

interface CartContextValue {
  cart: Cart | null;
  itemCount: number;
  total: number;
  loading: boolean;
  add: (item: Omit<CartItem, "id" | "quantity"> & { quantity?: number }) => Promise<void>;
  updateQty: (itemId: string, quantity: number) => Promise<void>;
  remove: (itemId: string) => Promise<void>;
  clear: () => Promise<void>;
  refresh: () => Promise<void>;
}

const CartContext = createContext<CartContextValue>({
  cart: null,
  itemCount: 0,
  total: 0,
  loading: false,
  add: async () => {},
  updateQty: async () => {},
  remove: async () => {},
  clear: async () => {},
  refresh: async () => {},
});

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(false);

  const persistKey = useCallback((key: string | null) => {
    if (typeof window === "undefined") return;
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const refresh = useCallback(async () => {
    if (typeof window === "undefined") return;
    const key = localStorage.getItem(STORAGE_KEY);
    if (!key) {
      setCart(null);
      return;
    }
    setLoading(true);
    try {
      const c = await apiGet(key);
      setCart(c);
    } catch {
      // 404 → stale key, clear it
      persistKey(null);
      setCart(null);
    } finally {
      setLoading(false);
    }
  }, [persistKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback<CartContextValue["add"]>(
    async (item) => {
      setLoading(true);
      try {
        const key = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
        const c = await apiAdd({
          cart_key: key ?? undefined,
          articleNo: item.articleNo,
          name: item.name,
          brand: item.brand,
          price: item.price,
          quantity: item.quantity ?? 1,
          image: item.image,
          sku: item.sku,
        });
        persistKey(c.key);
        setCart(c);
      } finally {
        setLoading(false);
      }
    },
    [persistKey]
  );

  const updateQty = useCallback<CartContextValue["updateQty"]>(
    async (itemId, quantity) => {
      if (!cart) return;
      setLoading(true);
      try {
        const c = await apiUpdate(cart.key, itemId, quantity);
        setCart(c);
      } finally {
        setLoading(false);
      }
    },
    [cart]
  );

  const remove = useCallback<CartContextValue["remove"]>(
    async (itemId) => {
      if (!cart) return;
      setLoading(true);
      try {
        const c = await apiRemove(cart.key, itemId);
        setCart(c);
      } finally {
        setLoading(false);
      }
    },
    [cart]
  );

  const clear = useCallback(async () => {
    if (!cart) return;
    setLoading(true);
    try {
      await apiClear(cart.key);
      persistKey(null);
      setCart(null);
    } finally {
      setLoading(false);
    }
  }, [cart, persistKey]);

  const itemCount = cart?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0;
  const total = cart?.items.reduce((sum, i) => sum + i.price * i.quantity, 0) ?? 0;

  return (
    <CartContext.Provider value={{ cart, itemCount, total, loading, add, updateQty, remove, clear, refresh }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  return useContext(CartContext);
}
