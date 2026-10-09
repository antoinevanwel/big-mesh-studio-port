// The root layout: what stays on screen around every route. The matched
// screen renders at <Outlet />. The modeller's theme is installed here,
// once, before anything themed draws.

import { SafeArea, setTheme, View } from "@solidrt/components"
import { Outlet } from "@solidrt/router"
import { GROUND, modellerTheme } from "./theme"

setTheme(modellerTheme)

export function App() {
  return (
    <View layout={{ flex: 1 }} style={{ backgroundColor: GROUND }}>
      <SafeArea>
        <Outlet />
      </SafeArea>
    </View>
  )
}
