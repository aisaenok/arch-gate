import test from "node:test";
import { parser } from "@lezer/java";

test("debug Java implements syntax tree", () => {
  const source = `
package dev.archgate;

import dev.archgate.api.ApplicationApi;

public final class ApplicationController implements ApplicationApi {
    @Override
    public String getApplication(String id) {
        return id;
    }
}
`;

  console.log("JAVA_TREE", parser.parse(source).toString());
});
