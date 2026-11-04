// 在已获准的申请页调用，逐项操作唯一可见控件，返回需要处理的字段名。
async function fillReviewedFields(tab, fields) {
  const page = tab.playwright;
  const done = [], pending = [];
  for (const field of fields) {
    try {
      const {kind, label, value} = field;
      if (!label || typeof value !== "string" || !value.trim())
        throw new Error("缺少已确认答案");
      const locator = page.getByLabel(label, {exact: true});
      if (await locator.count() !== 1 || !(await locator.isVisible()))
        throw new Error("字段需重新定位");
      if (kind === "text") {
        await locator.fill(value, {timeoutMs: 2500});
        if (await locator.evaluate(el => el.value) !== value)
          throw new Error("字段值未保留");
      } else if (kind === "select") {
        await locator.selectOption({label: value}, {timeoutMs: 2500});
        const actual = await locator.evaluate(el => el.selectedOptions[0]?.textContent.trim());
        if (actual !== value) throw new Error("选项未保留");
      } else {
        throw new Error("按页面处理此控件");
      }
      done.push(label);
    } catch {
      pending.push(field.label);
    }
  }
  return {done, pending};
}
