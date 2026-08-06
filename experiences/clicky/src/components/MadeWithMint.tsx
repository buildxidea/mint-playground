import { assetUrl } from "../lib/assetUrl";

export function MadeWithMint() {
  return (
    <a
      className="mint-badge"
      href="https://mint.gg/"
      target="_blank"
      rel="noreferrer"
      aria-label="Made with Mint"
    >
      <span>Made with</span>
      <img src={assetUrl("mint-logo.svg")} alt="" width={42} height={15} />
    </a>
  );
}
