import type { Preset } from "../style/preset-schema.ts";
import trainCarRecipe from "./train-car-recipe.fixture.json" with { type: "json" };

type HeroPropRecipe = NonNullable<Preset["heroProps"]>[string];

/**
 * A preset for tests of the recipe route: `base` with the old train-car recipe in its `heroProps` (replacing the
 * track bed) listed by the `platform` room type, and without the declared `train-car` mesh that stands on it now.
 */
export function withTrainCarRecipe(base: Preset): Preset {
  const meshes = Object.fromEntries(
    Object.entries(base.meshes ?? {}).filter(([kind]) => kind !== "train-car"),
  );
  const platform = base.roomTypes?.["platform"];
  return {
    ...base,
    meshes,
    heroProps: { ...base.heroProps, "train-car": trainCarRecipe as HeroPropRecipe },
    roomTypes: {
      ...base.roomTypes,
      ...(platform === undefined ? {} : { platform: { ...platform, heroProps: ["train-car"] } }),
    },
  };
}
