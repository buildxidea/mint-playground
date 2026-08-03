import type { MintPropAsset, MintPropPackDefinition } from './types';
import { mintRuntimeUrl, type MintRuntimeAssetKey } from '../mintRuntimeUrls';

type RoomPropAssetInput = Readonly<{
  index: number;
  id: string;
  label: string;
  itemRecordId: string;
  modelId: string;
  finalAssetId: string;
  artifactId: string;
  fileName: string;
  byteSize: number;
  sha256: string;
  note: string;
}>;

const FINAL_RIGID_GEOMETRY = Object.freeze({
  nodes: 1,
  meshes: 1,
  primitives: 1,
  materials: 1,
  textures: 3,
  animations: 0,
  skins: 0,
});

function createRoomInventory(
  roomId: 'precision-cell' | 'crisis-bay',
  inputs: readonly RoomPropAssetInput[],
): readonly MintPropAsset[] {
  return Object.freeze(
    inputs.map((input) =>
      Object.freeze({
        index: input.index,
        id: input.id,
        label: input.label,
        itemRecordId: input.itemRecordId,
        modelId: input.modelId,
        finalAssetId: input.finalAssetId,
        artifactId: input.artifactId,
        publicUrl: mintRuntimeUrl(
          `prop/${roomId}/${input.fileName.replace(/\.glb$/, '')}` as MintRuntimeAssetKey,
        ),
        filePath: `public/models/props/${roomId}/${input.fileName}` as MintPropAsset['filePath'],
        evidencePath:
          `data/mint/finals/${roomId}/props/artifact-manifest.json` as MintPropAsset['evidencePath'],
        byteSize: input.byteSize,
        sha256: input.sha256,
        staged: true,
        extensionsUsed: [],
        extensionsRequired: [],
        usesDraco: false,
        requiresDraco: false,
        geometry: FINAL_RIGID_GEOMETRY,
        capabilities: {
          rigidPropReady: true as const,
          articulatedInteractionReady: false as const,
          note: input.note,
        },
      }),
    ),
  );
}

function indexInventory(
  inventory: readonly MintPropAsset[],
): Readonly<Record<string, MintPropAsset>> {
  return Object.freeze(Object.fromEntries(inventory.map((asset) => [asset.id, asset])));
}

export const PRECISION_CELL_PROP_INVENTORY = createRoomInventory('precision-cell', [
  {
    index: 0,
    id: 'stackable-parts-bin',
    label: 'Stackable machine-vision parts bin',
    itemRecordId: 'td7fchvbb179472vcd3g2p0esd8bcppe',
    modelId: 'ks777636t2479wegyw92stc7e98bc1sf',
    finalAssetId: 'p9772jphj5md0rqwgt0we1yg118bcsmn',
    artifactId:
      'asset_pack_item_glb:vd75r43jk35v39wbmp0x4xcabd8bd99k:0:ks777636t2479wegyw92stc7e98bc1sf',
    fileName: '00-stackable-parts-bin.glb',
    byteSize: 852352,
    sha256: '9db9a0751f7eaf07264ca4ddbc6679ad0caa992d229b90f6c8b1567d2ea05de7',
    note: 'Final one-mesh bin is accepted as a rigid grasp-and-place payload.',
  },
  {
    index: 1,
    id: 'collaborative-transport-tote',
    label: 'Latching collaborative transport tote',
    itemRecordId: 'td7bdymwxw4325e1bavrrsdgps8bdp8n',
    modelId: 'ks7f1tzy1dnx8t8dh4xhgg8wdh8bcc7n',
    finalAssetId: 'p97563e4g5w5yv0ws58n3x71q98bc104',
    artifactId:
      'asset_pack_item_glb:vd75r43jk35v39wbmp0x4xcabd8bd99k:1:ks7f1tzy1dnx8t8dh4xhgg8wdh8bcc7n',
    fileName: '01-collaborative-transport-tote.glb',
    byteSize: 777404,
    sha256: '5066ec3bb1bb608f07ec2f22b7b888e826727663d5f8f2013c2b156cb62d49cf',
    note: 'Final tote is rigid; lid and latches are visual rather than separately articulated.',
  },
  {
    index: 2,
    id: 'calibrated-insertion-component',
    label: 'Calibrated insertion component',
    itemRecordId: 'td7519bhwvknp38crrtnt9fa798bcvvc',
    modelId: 'ks72x2sd29qtayqw0988q71y2n8bcg5n',
    finalAssetId: 'p978wgxxtdwkvpkvgkxc26e7fx8bc44p',
    artifactId:
      'asset_pack_item_glb:vd75r43jk35v39wbmp0x4xcabd8bd99k:2:ks72x2sd29qtayqw0988q71y2n8bcg5n',
    fileName: '02-calibrated-insertion-component.glb',
    byteSize: 900684,
    sha256: '2cbc4e8d86479453dda58910b76727d3ab1265e0513cc5e94a2dede6bf25eb58',
    note: 'Final keyed component is accepted as a rigid precision payload.',
  },
  {
    index: 3,
    id: 'instrumented-assembly-fixture',
    label: 'Instrumented assembly fixture',
    itemRecordId: 'td75g800536s4c18q87088wa2d8bc2j6',
    modelId: 'ks7a3z9fkq5kzmwzha7y0js6998bd342',
    finalAssetId: 'p97dnbkn6cb62a0dew4k6t8pnx8bdgxa',
    artifactId:
      'asset_pack_item_glb:vd75r43jk35v39wbmp0x4xcabd8bd99k:3:ks7a3z9fkq5kzmwzha7y0js6998bd342',
    fileName: '03-instrumented-assembly-fixture.glb',
    byteSize: 761424,
    sha256: '1e2c0db2fb87b369d0413b0e1a4760f0e5f5eecd69968f064751c3d37bae9660',
    note: 'Final fixture is accepted at its authored clamp setting as a rigid task target.',
  },
  {
    index: 4,
    id: 'heavy-exchange-fixture',
    label: 'Palletized heavy exchange fixture',
    itemRecordId: 'td717sg71ftrmbd14beyt631ns8bd4ks',
    modelId: 'ks7fy91sn7c65n8qvc4wjq4d7n8bdw2t',
    finalAssetId: 'p97974gfsehtcn241948k5xv318bcazy',
    artifactId:
      'asset_pack_item_glb:vd75r43jk35v39wbmp0x4xcabd8bd99k:4:ks7fy91sn7c65n8qvc4wjq4d7n8bdw2t',
    fileName: '04-heavy-exchange-fixture.glb',
    byteSize: 854940,
    sha256: '9e70ee1493f8579d73b9a7e203f517f98ce7c6025c834298b9f2b35bed02b668',
    note: 'Final pallet and fixture form one coherent rigid heavy payload.',
  },
  {
    index: 5,
    id: 'barcode-delivery-parcel',
    label: 'Lightweight barcode delivery parcel',
    itemRecordId: 'td7f3kdha0j9a2tmttnafahs9d8bcmzv',
    modelId: 'ks71jbexcn724sacrkmpqpj6k18bctz9',
    finalAssetId: 'p971tppk40zrcaj8ccsvrx3rx98bdkzh',
    artifactId:
      'asset_pack_item_glb:vd75r43jk35v39wbmp0x4xcabd8bd99k:5:ks71jbexcn724sacrkmpqpj6k18bctz9',
    fileName: '05-barcode-delivery-parcel.glb',
    byteSize: 990572,
    sha256: '132bfb276eef49d6703ced0f61f725a7a1cc1a97db1472c5de83692c98422b9c',
    note: 'Final parcel is accepted as a rigid lightweight delivery payload.',
  },
  {
    index: 6,
    id: 'optical-inspection-module',
    label: 'Fragile optical inspection module',
    itemRecordId: 'td7ddmp621c777d9bdfx6ga0358bdqe3',
    modelId: 'ks7bwdyykyjkfycctde63kk2j18bc5af',
    finalAssetId: 'p97czxtzbv59x5f0r57ca1zwfx8bdf5n',
    artifactId:
      'asset_pack_item_glb:vd75r43jk35v39wbmp0x4xcabd8bd99k:6:ks7bwdyykyjkfycctde63kk2j18bc5af',
    fileName: '06-optical-inspection-module.glb',
    byteSize: 1047528,
    sha256: 'bc75e92d64d782eb89baabe4c51f2353cc1f144ea15c56e772d35d943683cde9',
    note: 'Final protected sensor carrier is accepted as a rigid fragile payload.',
  },
  {
    index: 7,
    id: 'electric-torque-driver',
    label: 'Robot-compatible electric torque driver',
    itemRecordId: 'td74k1p6y7hhf00qzvwyzfske18bd1kn',
    modelId: 'ks77ehvzycydbyrhm3wq1xma7n8bc1fw',
    finalAssetId: 'p970k6vrthjqmhxqsmx3f0bhws8bdtbk',
    artifactId:
      'asset_pack_item_glb:vd75r43jk35v39wbmp0x4xcabd8bd99k:7:ks77ehvzycydbyrhm3wq1xma7n8bc1fw',
    fileName: '07-electric-torque-driver.glb',
    byteSize: 774352,
    sha256: 'cdc2f63944a6e2fbd561a05d2c6e56eb16e0aa58f5636240a7dd786e8fba5961',
    note: 'Final tool is accepted as a rigid graspable driver; controls are not separately animated.',
  },
]);

export const CRISIS_BAY_PROP_INVENTORY = createRoomInventory('crisis-bay', [
  {
    index: 0,
    id: 'shutoff-valve-trainer',
    label: 'Portable large shutoff-valve trainer',
    itemRecordId: 'td7e2j8jry7v1bdv09gnwkrv358bc5ce',
    modelId: 'ks73jw3r8fcnbgr7jwdj9dn1cx8bdrqv',
    finalAssetId: 'p97ck2x69y2j7xdszgc8br96518bcvdz',
    artifactId:
      'asset_pack_item_glb:vd7br8ha4nv8z47zh5d837aefn8bdf4x:0:ks73jw3r8fcnbgr7jwdj9dn1cx8bdrqv',
    fileName: '00-portable-large-shutoff-valve-trainer.glb',
    byteSize: 822164,
    sha256: '095777f46d632d7f61013dddd0ac564ecb5ca32465e3567e9e45c64d1753bd59',
    note: 'Final valve trainer is rigid; handwheel rotation is represented by task state.',
  },
  {
    index: 1,
    id: 'rescue-mannequin',
    label: 'Instrumented rescue mannequin',
    itemRecordId: 'td7fbjcch0rk0kk2k7ydqnvf5s8bdvh2',
    modelId: 'ks79mp40nyr1vhet21cwdzbf618bcjqp',
    finalAssetId: 'p97axyzbjs5yvpwh6zhndy8pjn8bdt2m',
    artifactId:
      'asset_pack_item_glb:vd7br8ha4nv8z47zh5d837aefn8bdf4x:1:ks79mp40nyr1vhet21cwdzbf618bcjqp',
    fileName: '01-instrumented-rescue-mannequin.glb',
    byteSize: 1106712,
    sha256: 'a191ec6e43b579243abcea966c4b9280dc4de7d1c6eda23546ded4ab1aff1157',
    note: 'Final nonhuman training mannequin is accepted as one rigid rescue target.',
  },
  {
    index: 2,
    id: 'rescue-equipment-case',
    label: 'Sealed rescue equipment case',
    itemRecordId: 'td78kyz7z9hk3mb7vmfw6hcga18bcf2q',
    modelId: 'ks74nvj30y60azr5a0txvmyxxh8bd1ws',
    finalAssetId: 'p97cw9e9d6j9m6gzs1hm2d78ss8bdy2r',
    artifactId:
      'asset_pack_item_glb:vd7br8ha4nv8z47zh5d837aefn8bdf4x:2:ks74nvj30y60azr5a0txvmyxxh8bd1ws',
    fileName: '02-sealed-rescue-equipment-case.glb',
    byteSize: 969496,
    sha256: 'e389c0f4b888c95d2042b3df8f2767d23fe77aa48db47019b385c86eef7a4279',
    note: 'Final sealed case is accepted as a rigid response-kit payload.',
  },
  {
    index: 3,
    id: 'emergency-supply-tote',
    label: 'Emergency supply tote',
    itemRecordId: 'td73cqa42zkga2cs6s8ca6bren8bdx0g',
    modelId: 'ks7drrf65vqdwh70q14j6r036n8bdvtf',
    finalAssetId: 'p970f8enkqz1cpqbkm07ze35858bdwzr',
    artifactId:
      'asset_pack_item_glb:vd7br8ha4nv8z47zh5d837aefn8bdf4x:3:ks7drrf65vqdwh70q14j6r036n8bdvtf',
    fileName: '03-emergency-supply-tote.glb',
    byteSize: 793968,
    sha256: 'fae5a622bd5819f8bc9fe09bce15301da832b275066ddf0dd725287f982fb6ea',
    note: 'Final tote is accepted as a rigid emergency logistics payload.',
  },
  {
    index: 4,
    id: 'structural-debris-block',
    label: 'Modular structural debris block',
    itemRecordId: 'td7cpx45ynda62c3avqsrq49718bcssm',
    modelId: 'ks7fp0m749nc7dq86b23qb39es8bc7yq',
    finalAssetId: 'p97ctbpm7jfcadq3g4wg4xw2d58bdatx',
    artifactId:
      'asset_pack_item_glb:vd7br8ha4nv8z47zh5d837aefn8bdf4x:4:ks7fp0m749nc7dq86b23qb39es8bc7yq',
    fileName: '04-modular-structural-debris-block.glb',
    byteSize: 1281540,
    sha256: '7e7496fcc74fcb875b59ffca53dc0850c421c37e00f8db1a32f27a9a1357b463',
    note: 'Final protected obstruction is accepted as a rigid debris-clearing payload.',
  },
  {
    index: 5,
    id: 'recovery-bogie',
    label: 'Disabled-equipment recovery bogie',
    itemRecordId: 'td707fdskpe7n6949f9fsca3hs8bdax9',
    modelId: 'ks75yk4w3gxh7kbajppq4bvwcx8bd838',
    finalAssetId: 'p976wj4q0p14q5cnbcpp1ew5k18bc3ys',
    artifactId:
      'asset_pack_item_glb:vd7br8ha4nv8z47zh5d837aefn8bdf4x:5:ks75yk4w3gxh7kbajppq4bvwcx8bd838',
    fileName: '05-disabled-equipment-recovery-bogie.glb',
    byteSize: 1059084,
    sha256: '28e5c64a8e61e17fac5f754f0371bef03ffa37e706cd7a465582da259b182781',
    note: 'Final bogie is accepted as a rigid tow target; caster motion is not authored separately.',
  },
  {
    index: 6,
    id: 'leak-localization-cylinder',
    label: 'Leak-localization cylinder trainer',
    itemRecordId: 'td7b827pnbtyar7cgtt5q1j4vs8bdsgd',
    modelId: 'ks78907bst9hkjgx2b5fh2w8k58bdggr',
    finalAssetId: 'p9706hsxzmy4d421bpvrn99qy58bcj2r',
    artifactId:
      'asset_pack_item_glb:vd7br8ha4nv8z47zh5d837aefn8bdf4x:6:ks78907bst9hkjgx2b5fh2w8k58bdggr',
    fileName: '06-leak-localization-cylinder-trainer.glb',
    byteSize: 1008520,
    sha256: '0d53839db6d305d9128b8a1fda705477232e7ab497bdc2641bc97d40a2c7851f',
    note: 'Final secured cylinder is accepted as a rigid localization target.',
  },
  {
    index: 7,
    id: 'isolation-control-cabinet',
    label: 'Portable isolation control cabinet',
    itemRecordId: 'td7ak11wnhj7bj643reysvhk218bdyft',
    modelId: 'ks7ed1hyd775yysdzatw1fzash8bdfnx',
    finalAssetId: 'p979j51df6evnmjwjj8knm53d58bc6fk',
    artifactId:
      'asset_pack_item_glb:vd7br8ha4nv8z47zh5d837aefn8bdf4x:7:ks7ed1hyd775yysdzatw1fzash8bdfnx',
    fileName: '07-portable-isolation-control-cabinet.glb',
    byteSize: 778688,
    sha256: '44d7b364d20b6a63d43592b0dbc6fa7c7b943e7174b3d3a02714927a4ba9d219',
    note: 'Final cabinet is rigid; button and switch actions are represented by task state.',
  },
]);

export const PRECISION_CELL_PROP_BY_ID = indexInventory(PRECISION_CELL_PROP_INVENTORY);
export const CRISIS_BAY_PROP_BY_ID = indexInventory(CRISIS_BAY_PROP_INVENTORY);

export const PRECISION_CELL_PROP_DEFINITION = Object.freeze({
  roomId: 'precision-cell',
  assetPackId: 'th76a7t8sm7hsc8ak757daeke18bcv0d',
  name: 'PROJECT FORGE-5 — Precision Cell Manipulation Props',
  itemCount: 8,
  inventory: PRECISION_CELL_PROP_INVENTORY,
  byId: PRECISION_CELL_PROP_BY_ID,
}) satisfies MintPropPackDefinition;

export const CRISIS_BAY_PROP_DEFINITION = Object.freeze({
  roomId: 'crisis-bay',
  assetPackId: 'th7865tpq6nr1tvz0ckaj1pk9h8bcqcx',
  name: 'PROJECT FORGE-5 — Crisis Bay Response Props',
  itemCount: 8,
  inventory: CRISIS_BAY_PROP_INVENTORY,
  byId: CRISIS_BAY_PROP_BY_ID,
}) satisfies MintPropPackDefinition;

for (const definition of [PRECISION_CELL_PROP_DEFINITION, CRISIS_BAY_PROP_DEFINITION]) {
  if (
    definition.inventory.length !== definition.itemCount ||
    definition.inventory.some((asset, index) => asset.index !== index)
  ) {
    throw new Error(`${definition.name} does not match its finalized Mint pack ordering`);
  }
}
