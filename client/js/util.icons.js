import helpCircleSvg from '../assets/icons/help-circle.svg?raw';
import chevronLeftSvg from '../assets/icons/chevron-left.svg?raw';
import joinRoomSvg from '../assets/icons/join-room.svg?raw';
import settingsGearSvg from '../assets/icons/settings-gear.svg?raw';
import emojiSmileSvg from '../assets/icons/emoji-smile.svg?raw';
import attachSvg from '../assets/icons/attach.svg?raw';
import sendSvg from '../assets/icons/send.svg?raw';
import headerHomeSvg from '../assets/icons/header-home.svg?raw';
import headerMoreSvg from '../assets/icons/header-more.svg?raw';
import headerMembersSvg from '../assets/icons/header-members.svg?raw';
import fileDownloadSvg from '../assets/icons/file-download.svg?raw';

export const ICONS = {
  helpCircle: helpCircleSvg,
  chevronLeft: chevronLeftSvg,
  joinRoom: joinRoomSvg,
  settingsGear: settingsGearSvg,
  emojiSmile: emojiSmileSvg,
  attach: attachSvg,
  send: sendSvg,
  headerHome: headerHomeSvg,
  headerMore: headerMoreSvg,
  headerMembers: headerMembersSvg,
  fileDownload: fileDownloadSvg,
};

export function injectStaticIcons(root = document) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const iconName = el.dataset.icon;
    const iconSvg = ICONS[iconName];
    if (!iconSvg) return;
    el.innerHTML = iconSvg;
  });
}
