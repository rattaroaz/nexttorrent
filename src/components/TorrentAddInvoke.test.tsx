import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as client from "../ipc/client";

vi.mock("../ipc/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../ipc/client")>();
  return {
    ...mod,
    torrentAddFile: vi.fn(() => Promise.resolve({})),
  };
});

function AddTorrentStub() {
  return (
    <button
      type="button"
      onClick={() => {
        void client.torrentAddFile("/seed/example.torrent", null, null, false);
      }}
    >
      Add file
    </button>
  );
}

describe("TorrentAddInvoke", () => {
  beforeEach(() => {
    vi.mocked(client.torrentAddFile).mockClear();
  });

  it("calls torrentAddFile with expected args when triggered", () => {
    render(<AddTorrentStub />);
    fireEvent.click(screen.getByRole("button", { name: /add file/i }));
    expect(client.torrentAddFile).toHaveBeenCalledWith(
      "/seed/example.torrent",
      null,
      null,
      false,
    );
  });
});
