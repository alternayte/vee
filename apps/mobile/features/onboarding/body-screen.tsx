// SPDX-License-Identifier: AGPL-3.0-or-later
import { router } from "expo-router";
import { useState } from "react";
import { Choice } from "@/components/ui/choice";
import { Text } from "@/components/ui/text";
import { num, setDraft, useDraft } from "./draft";
import { Field, Step } from "./step";

const str = (n: number | undefined) => (n === undefined ? "" : String(n));

export function BodyScreen() {
  const body = useDraft((s) => s.body);
  const [height, setHeight] = useState(str(body.heightCm));
  const [weight, setWeight] = useState(str(body.weightKg));
  const [born, setBorn] = useState(str(body.birthYear));
  const [waist, setWaist] = useState(str(body.waistCm));
  const [sex, setSex] = useState(body.sex);

  const h = num(height);
  const w = num(weight);
  const y = num(born);
  const year = new Date().getFullYear();
  const ok =
    h !== undefined &&
    h >= 120 &&
    h <= 230 &&
    w !== undefined &&
    w >= 30 &&
    w <= 250 &&
    y !== undefined &&
    Number.isInteger(y) &&
    y >= year - 100 &&
    y <= year - 13 &&
    sex !== undefined;

  return (
    <Step
      step="body"
      title="Your body"
      intro="The plan and the food targets use these numbers. Only you see them."
      canNext={ok}
      next={() => {
        const waistCm = num(waist);
        setDraft({
          body: {
            heightCm: Math.round(h as number),
            weightKg: w as number,
            birthYear: y as number,
            sex: sex as "male" | "female",
            ...(waistCm === undefined ? {} : { waistCm }),
          },
        });
        router.push("/welcome/kit");
      }}
    >
      <Field label="Height" unit="cm" value={height} onChange={setHeight} testID="height" />
      <Field label="Weight" unit="kg" value={weight} onChange={setWeight} testID="weight" />
      <Field label="Year of birth" value={born} onChange={setBorn} testID="birth-year" />
      <Text variant="label">Sex</Text>
      <Choice
        options={[
          { value: "male", label: "Male" },
          { value: "female", label: "Female" },
        ]}
        selected={sex ? [sex] : []}
        onToggle={(v) => setSex(v)}
      />
      <Field
        label="Waist at the navel, optional"
        unit="cm"
        value={waist}
        onChange={setWaist}
        testID="waist"
      />
    </Step>
  );
}
