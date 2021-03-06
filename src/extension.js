/**********************************************************\ 
Original Author: Kyle L. Huff (kylehuff)

Created:    Apr 2, 2013
License:    GNU General Public License, version 2
            http://www.gnu.org/licenses/gpl-2.0.html

Copyright 2013 Kyle L. Huff, CURETHEITCH development team
\**********************************************************/
const Signals = imports.signals;
const Lang = imports.lang;
const St = imports.gi.St;
const Main = imports.ui.main;
const Panel = imports.ui.panel;
const DND = imports.ui.dnd;
const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ModalDialog   = imports.ui.modalDialog;
const UUID = "indecision@curetheitch.com";

const PANEL_ICON_SIZE = Panel.PANEL_ICON_SIZE;
try {
    const STANDARD_TRAY_ICON_IMPLEMENTATIONS = imports.ui.statusIconDispatcher.STANDARD_TRAY_ICON_IMPLEMENTATIONS;
} catch (err) {
    const STNADARD_TRAY_ICON_IMPLEMENTATIONS = imports.ui.notificationDaemon.STANDARD_TRAY_ICON_IMPLEMENTATIONS;
}

try {
    const StatusIconDispatcherOrig = imports.ui.statusIconDispatcher;
} catch (err) {
    const notificationDaemon = imports.ui.notificationDaemon;
}

let convertedItems = [];
let dragActor,
    dragActorSource,
    dragActorTarget,
    dragTarget;
let insertPosition = 0;
let targetPanels = [Main.panel._leftBox,
    Main.panel._centerBox,
    Main.panel._rightBox];

let _makeItemDraggable = function(panelItem, trayIcon) {
    if (panelItem._delegate == undefined || panelItem._delegate instanceof St.Bin)
        panelItem = panelItem.get_children()[0];

    // Enforce the _delegate
    if (panelItem._delegate == undefined)
        panelItem._delegate = panelItem;

    // Assign the getDragActor method
    panelItem._delegate.getDragActor = function() {
        // Return a useless and tiny image. We are using another
        //  form of a visual cue, however, without this method
        //  assigned to the delegate object, the panel item
        //  gets removed from the panel on drag, which we don't
        //  want because it will change the panel object count.
        return new St.Icon({ icon_name: 'system-run',
                    icon_size: 1,
                    style_class: 'system-status-icon' });
    }

    // DnD'ify the item
    panelItem._draggable = DND.makeDraggable(panelItem);
    panelItem._draggable._delegate = panelItem;

    // Bind the DnD events to the item
    // TODO: implement drag-cancel (?)
    panelItem._draggable.connect('drag-begin', Lang.bind(panelItem, _onDragBegin));
    panelItem._draggable.connect('drag-end', Lang.bind(panelItem, _onDragEnd));
}

let _getAllPanelChildren = function() {
    return Main.panel._leftBox.get_children().
        concat(Main.panel._centerBox.get_children()).
        concat(Main.panel._rightBox.get_children());
}

let _arrangePanelItem = function(panelItem, extName) {
    if (this._state.hasOwnProperty(extName)) {
        for (let panel in targetPanels) {
            if (targetPanels[panel].name == this._state[extName].panel) {
                let targetPanel = targetPanels[panel];
                // It is possible that the specified position for a given item
                //  was set while more panel items existed, so our position
                //  will be off; the following offset variable reduces the
                //  position value by the item-count discrepancy.
                let position = (this._state[extName].position > targetPanel.get_children().length - 1)
                    ? this._state[extName].position - (this._state[extName].position + 1 - targetPanel.get_children().length)
                    : this._state[extName].position;
                switch (this._state[extName].position) {
                    case -2:
                        // hide the element
                        panelItem.hide();
                        // Refresh the stored list
                        break;

                    case -3:
                        // destroy the element
                        panelItem.destroy();
                        break;

                    default:
                        panelItem.get_parent().remove_actor(panelItem);
                        if (targetPanel.insert_actor!=undefined)
                            targetPanel.insert_actor(panelItem, position);
                        else
                            targetPanel.insert_child_at_index(panelItem, position);
                        break;
                }
            }
        }
    }
}

let _reorderIcons = function(event) {
    let panelChildren = _getAllPanelChildren();

    // Iterate through the panel items
    for (let i = 0, len = panelChildren.length; i < len; i++) {
        // Retrieve the calculated name for the current item
        let extName = _getExtUUIDByPanelObject(panelChildren[i]);

        // Check if this item has already been DnD'ified
        if (convertedItems.indexOf(panelChildren[i]) < 0) {
            if (extName) {
                _makeItemDraggable(panelChildren[i]);

                // Add the newly DnDified item to the global list
                //  of converted panel items
                convertedItems.push(panelChildren[i]);
            }
        }
        if (extName)
            _arrangePanelItem(panelChildren[i], extName);
    }
}

/*
    Function: _onDragBegin
        Called when a DnD'ified item begins a drag

    Parameters:
        draggable - <draggable object> The draggable item
        time - <time obj> The timestamp for the event
*/
let _onDragBegin = function(draggable, time) {
    dragActor = draggable.actor;
    dragActorSource = dragActor.get_parent();

    // Attempt to close any menus that are open
    try {
        let menus = (Main.panel._menus != undefined)
            ? Main.panel._menus._menus
            : Main.panel.menuManager._menus;
        for (menu in menus) { menus[menu].menu.close() }
        Main.lookingGlass.close();
    } catch (err) {
        global.log(err.message);
    }

    // Show the actionPanel drop target
    _actionPanel.showActionPanel();

    // Set the dragMonitor
    DND.addDragMonitor(_dragMonitor);
}

/*
    Function: _onDragMotion
        Called when a DnD'ified item is being dragged

    Parameters:
        dragEvent - <event> The drag event [dragActor, source, targetActor, x, y]

    Returns:
        DND.DragMotionResult
*/
let _onDragMotion = function(dragEvent) {
    // Check if we need to remove styles from the previous target
    if (dragTarget && dragTarget != dragEvent.targetActor && dragTarget.remove_style_class_name) {
        dragTarget.remove_style_class_name('dnd-border-left');
        dragTarget.remove_style_class_name('dnd-border-right');
    }

    // The panel item being dragged over
    dragTarget = dragEvent.targetActor;

    // Check if the target is a panel, insted of a panel Item
    if (targetPanels.indexOf(dragTarget) < 0) {
        // Get the top-most panel item, 1-down from the panel
        let parseItem = function(item) {
            if (targetPanels.indexOf(item.get_parent()) > -1)
                return item;

            if (item.get_parent && item.get_parent())
                return parseItem(item.get_parent());
            else
                return dragTarget;
        }

        dragTarget = parseItem(dragTarget);
        
        if (targetPanels.indexOf(dragTarget.get_parent()) > -1) {
            // Define the dragActorTarget as the parent panel of the panel item
            dragActorTarget = dragTarget.get_parent();

            // Define the position within the panel to drop the item
            if (dragTarget instanceof Main.Shell.GenericContainer || dragTarget instanceof St.Bin) {
                [targetX, targetY] = dragTarget.get_transformed_position();
                let targetXOffset = parseInt(targetX) + parseInt(dragTarget.get_width() / 2);
                if (dragEvent.x > targetXOffset) {
                    // right of item
                    insertPosition = dragActorTarget.get_children().indexOf(dragTarget);
                    dragTarget.remove_style_class_name('dnd-border-left');
                    dragTarget.add_style_class_name('dnd-border-right');
                    
                } else {
                    // left of item
                    insertPosition = dragActorTarget.get_children().indexOf(dragTarget);
                    dragTarget.remove_style_class_name('dnd-border-right');
                    dragTarget.add_style_class_name('dnd-border-left');
                }
            }
        } else {
            // Possibly over our action panel
            if (dragEvent.targetActor.get_parent() && (dragEvent.targetActor._delegate instanceof actionPanel
            || dragEvent.targetActor.get_parent()._delegate instanceof actionPanel)) {
                insertPosition = -2;
            }
        }
    } else {
        dragActorTarget = dragTarget;
        insertPosition = 0;
    }

    for (let panel in targetPanels)
        targetPanels[panel].add_style_class_name('panel-reactive');

    if (dragActorTarget)
        return DND.DragMotionResult.MOVE_DROP;

    return DND.DragMotionResult.CONTINUE;
}

/*
    Function: _onDragEnd
        Called when a DnD'ified item has been dropped

    Parameters:
        draggable - <draggable object> The draggable item
        time - <time obj> The timestamp for the event
        snapback - <bool> ?
*/
let _onDragEnd = function(draggable, time, snapback) {
    for (let panel in targetPanels)
        targetPanels[panel].remove_style_class_name('panel-reactive');

    if (dragActorTarget) {
        let extName = _getExtUUIDByPanelObject(dragActor);
        if (extName) {
            if (insertPosition > -1)
                _state = JSON.parse(_arrangeItem(insertPosition, dragActorTarget.name));

            _state[extName] = {
                'panel': dragActorTarget.name,
                'position': insertPosition
            };

            _settings.save_state(_state);
        }
        switch (insertPosition) {
            case -2:
                // hide the element
                dragActor.hide();
                break;

            case -3:
                // destroy the element
                dragActor.destroy();
                break;

            case -4:
                // Disable this extension applet
                break;

            default:
                // Move the element
                let removeParent = (dragActor.get_parent() instanceof St.Bin);
                let dragActorParent = dragActor.get_parent();
                dragActorParent.remove_actor(dragActor);
                if (removeParent)
                    dragActorParent.destroy();
                if (dragActorTarget.insert_actor!=undefined)
                    dragActorTarget.insert_actor(dragActor, insertPosition);
                else
                    dragActorTarget.insert_child_at_index(dragActor, insertPosition);
                break;
        }
    } else {
        draggable._cancelDrag(time);
    }

    dragTarget.remove_style_class_name('dnd-border-left');
    dragTarget.remove_style_class_name('dnd-border-right');
    _actionPanel.hideActionPanel();
    DND.removeDragMonitor(_dragMonitor);

    return true;
}

let _dragMonitor = {
    dragMotion: Lang.bind(this, _onDragMotion)
};

/*
    Function: _arrangeItem
        Method to handle making room in the _state object
        for the given panelItemPosition for the panel

    Parameters:
        panelItemPosition - <int> The position specified
        panelName - <string> The target panel name
*/
let _arrangeItem = function(position, panelName) {
    let stringState = JSON.stringify(_state);

    let places = stringState.match(
            new RegExp(panelName + ".*?position[\"|\']\:(\\d+)", "gim")
        );

    if (places)
        places = places.map(function(x) { return parseInt(x.split(":")[1]); })

    if (places && places.indexOf(position) !== -1) {
        let iter = 0;
        global.log("Already something at this position (" + position + "); shifting list");
        stringState = stringState.replace(
            new RegExp("(" + panelName + ".*?position[\"|\']\:)(\\d+)", "gim"),
            function(s, m, g1) {
                let	 i = (g1 == position) ? parseInt(g1) + iter : 
                    (parseInt(g1) <= position) ? parseInt(g1) - iter :
                    (iter == 0) ? parseInt(g1) + 1 : parseInt(g1) + iter - 1;
                if (g1 == position)
                    iter++;
                return m + parseInt(i + iter);
            }
        )
    }
    return stringState;
}

/*
    Function: _getExtUUIDByPanelObject
        Determines the UUID of the given panel item if it is an
        extension item, or the indicator name if it is a system
        indicator.

    Parameters:
        panelItem - <panel actor object> The panel item
*/
let _getExtUUIDByPanelObject = function(panelItem) {
    let delegate = (panelItem.hasOwnProperty('_delegate') && !panelItem._delegate instanceof St.Bin)
        ? panelItem._delegate
        : panelItem.get_children()[0]._delegate;

    if (delegate == undefined) 
        delegate = panelItem._delegate;

    if (!panelItem.hasOwnProperty('_delegate'))
        panelItem = panelItem.get_children()[0];

    let extObjs = (Main.ExtensionSystem.hasOwnProperty('extensionStateObjs'))
        ? Main.ExtensionSystem.extensionStateObjs
        : Main.ExtensionSystem.ExtensionUtils.extensions;

    for (let ext in extObjs) {
        let extObj = (Main.ExtensionSystem.hasOwnProperty('extensionStateObjs'))
            ? extObjs[ext] : (extObjs[ext].hasOwnProperty('stateObj')) ? extObjs[ext].stateObj : {};

        let objKeys = Object.keys(extObj);

        for (let i = 0, len = objKeys.length; i < len; i++) {
            if ((extObj[objKeys[i]] == panelItem
            || extObj[objKeys[i]] == delegate
            || extObj[objKeys[i]] == panelItem._delegate)
            && objKeys[i] != 'dragActor'
            && objKeys[i] != 'dragTarget')
                return ext;
        }
    }
    let statusArea = (Main.panel.hasOwnProperty('_statusArea'))
        ? Main.panel._statusArea : Main.panel.statusArea;

    for (let statusItem in Main.panel._statusArea) {
        if (Main.panel._statusArea[statusItem]
        && Main.panel._statusArea[statusItem].actor == panelItem)
            return statusItem + "@shellindicator";
    }

    let delegateKeyName = "";

    if (panelItem.get_children != undefined && panelItem.get_children().toString().indexOf("ShellTrayIcon") > -1) {
        try {
            delegateKeyName = panelItem.get_children()[0]._role.toLowerCase();
        } catch (err) {
            // Use the calculated name for the icon (yet TODO)
            delegateKeyName = "unknown-trayicon";
        } finally {
            delegateKeyName += "@shelltrayindicator";
        }
    } else {
        let objName = delegate.toString().replace(/\[\w+\s(.*?)\]/gim, "$1");
        if (delegate.toString().indexOf(objName) > -1)
            return objName + "@shellindicator";

        // Used as the extension/object name when the item is not an
        //  an extension or indicator (i.e. the activities menu), and
        //  cannot otherwise be determined
        let randomID = "";
        for (let objKey in delegate) {
            // Convert the objKey to a string
            objString = objKey.toString();
            // Take a portion of that string and use it for our randomID
            randomID += objString.substring(objString.length / 2, (objString.length / 2) + 1);
        }
        return randomID + "@shellindicator";
    }

    return delegateKeyName.toLowerCase();
}


function init(metadata) {
    this._extensionPath = metadata.path;
}

function indecisionApplet() {
	this._init.apply(this, arguments);
}

indecisionApplet.prototype = {
    __proto__: PanelMenu.Button.prototype,

    _init: function() {
        PanelMenu.Button.prototype._init.call(this, 0.0);

        this._icon = new St.Icon({
            icon_name: 'go-bottom-symbolic',
            style_class: 'system-status-icon'
        });

        this._icon.height = PANEL_ICON_SIZE;
        this.actor.add_actor(this._icon);
        
        this._configSubMenu = new PopupMenu.PopupSubMenuMenuItem("Settings");
        
        let combo = new PopupMenu.PopupSwitchMenuItem(
            "Move Tray Icons to Panel", (_config && _config['trayIcons'])
        );

        combo.connect('toggled', Lang.bind(this,
            function(item, state) {
                if (state)
                    _config.trayIcons = true;
                else
                    _config.trayIcons = false;

                _settings.save_config(_config);
                if (!_indecisionApplet._noRestartRequired) {
                    new PromptUserRestart().open();
                } else {
                    _indecisionApplet._noRestartRequired = false;
                }
            })
        );
        this._configSubMenu.menu.addMenuItem(combo);
        this._getExtUUIDByPanelObject = _getExtUUIDByPanelObject;
        this._getAllPanelChildren = _getAllPanelChildren;

        this._hiddenSubMenu = new PopupMenu.PopupSubMenuMenuItem("Indicators");
        this._hiddenSubMenu.actor.connect('button-press-event', Lang.bind(this, this._updateHiddenSubMenu));
        this._extSubMenu = new PopupMenu.PopupSubMenuMenuItem("Extensions");
        this._extSubMenu.actor.connect('button-press-event', Lang.bind(this, this._updateExtensionSubMenu));

        this.menu.addMenuItem(this._configSubMenu);
        this.menu.addMenuItem(this._hiddenSubMenu);
        this.menu.addMenuItem(this._extSubMenu);
        let menuManager = (Main.panel._menus != undefined)
            ? Main.panel._menus
            : Main.panel.menuManager;
        menuManager.addMenu(this.menu);
        if (Main.panel.hasOwnProperty('_insertStatusItem')) {
            Main.panel._insertStatusItem(this.actor, 0);
            Main.panel._statusArea['indecision@curetheitch.com'] = this;
        } else {
            Main.panel.addToStatusArea(UUID, this, 0);
        }
        
    },

    _updateHiddenSubMenu: function() {
        if (this._hiddenSubMenu.menu.isOpen)
            return;

        this._hiddenSubMenu.menu.removeAll();
        let panelChildren = _getAllPanelChildren();

        // Iterate through the panel items
        for (let i = 0, len = panelChildren.length; i < len; i++) {
            // Retrieve the calculated name for the current item
            let extensionObject = panelChildren[i];
            if (!extensionObject)
                return;

            let UUID = _getExtUUIDByPanelObject(extensionObject);

            let extension = (Main.ExtensionSystem.hasOwnProperty('extensionMeta'))
                ? Main.ExtensionSystem.extensionMeta[UUID]
                : (Main.ExtensionSystem.ExtensionUtils.extensions[UUID] != undefined)
                    ? Main.ExtensionSystem.ExtensionUtils.extensions[UUID].metadata
                    : null;

            if (!extension)
                extension = { 'name': UUID };

            let hidden = (_state[UUID] && _state[UUID].position < 0)
            let combo = new PopupMenu.PopupSwitchMenuItem(
                extension.name, !hidden
            );
            combo.connect('toggled', Lang.bind(this,
                function(item, state) {
                    if (state) {
                        Main.notify("Restoring: " + extension.name);
                        delete _state[UUID];
                        _settings.save_state(_state);
                        extensionObject.show();
                        Main.ExtensionSystem._signals.emit('extension-loaded', extension);
                     } else {
                        Main.notify("Hiding: " + extension.name);
                        _state[UUID] = {
                            panel: 'panelRight',
                            position: -2
                        }
                        _settings.save_state(_state);
                        Main.ExtensionSystem._signals.emit('extension-loaded', extension);
                     }
                     extensionObject.remove_style_class_name('highlight-indicator');
                })
            );
            this._hiddenSubMenu.menu.addMenuItem(combo);
            combo.actor.set_reactive(true);
            combo.actor.connect('enter-event', Lang.bind(this,
                function() {
                    extensionObject.add_style_class_name('highlight-indicator');
                })
            );
            combo.actor.connect('leave-event', Lang.bind(this,
                function() {
                    extensionObject.remove_style_class_name('highlight-indicator');
                })
            );
            // Disconnect the signal stored in _activateId, as it closes the
            //  menu when we don't want to
            combo.disconnect(combo._activateId);
            // Without populating the _activateId with a valid signal
            //  connection, when the item is destroyed, it can cause
            //  an error within signals.js in gnome-shell v3.2.2.1
            combo._activateId = combo.connect('dummy-event', function() {});
        }
    },

    _updateExtensionSubMenu: function() {
        if (this._extSubMenu.menu.isOpen)
            return;
        let _extensionMeta;
        if (Main.shellDBusService.ListExtensions != undefined)
            _extensionMeta = Main.shellDBusService.ListExtensions();
        else if (Main.shellDBusService.hasOwnProperty('_extensionsSerivce'))
            _extensionMeta = Main.shellDBusService._extensionsSerivce.ListExtensions();
        else
            _extensionMeta = Main.shellDBusService._extensionsService.ListExtensions();

        let _sortedExtensionObj = {};

        Object.keys(_extensionMeta).map(
            function(key) {
                let name = (Main.ExtensionSystem.hasOwnProperty('ExtensionUtils'))
                    ? Main.ExtensionSystem.ExtensionUtils.extensions[key].metadata.name.toLowerCase()
                    : _extensionMeta[key].name.toLowerCase();
                _sortedExtensionObj[name] = _extensionMeta[key];
                return key;
            }
        );

        let _sortedExtensionList = Object.keys(_sortedExtensionObj).sort().map(function(key) {
                let uuid = _sortedExtensionObj[key].uuid;
                if (typeof(uuid)!='string')
                    uuid = uuid.get_string()[0];
                return uuid;
        })

        this._extSubMenu.menu.removeAll();
        for (let i = 0, len = _sortedExtensionList.length, UUID; UUID = _sortedExtensionList[i], i < len; i++) {
            let extension = (Main.ExtensionSystem.hasOwnProperty('ExtensionUtils'))
                ? Main.ExtensionSystem.ExtensionUtils.extensions[UUID]
                : _extensionMeta[UUID];
            if (!extension)
                continue;
            let name = (extension.hasOwnProperty('metadata')) ? extension.metadata.name : extension.name;
            let enableCombo = new PopupMenu.PopupSwitchMenuItem(
                name, extension.state === 1
            );
            enableCombo.connect('toggled', Lang.bind(this,
                function(item, state) {
//TODO: reliable method for getting the actor of the given extension
//                    let actor = (Main.ExtensionSystem.hasOwnProperty('extensionStateObjs'))
//                        ? Main.ExtensionSystem.extensionStateObjs[UUID].actor
//                        : Main.ExtensionSystem.ExtensionUtils.extensions[UUID].stateObj;
//                    if (actor && convertedItems.indexOf(actor._delegate) > -1)
//                        convertedItems.pop(actor._delegate);
                    let ENABLED_EXTENSIONS_KEY = Main.ExtensionSystem.ENABLED_EXTENSIONS_KEY;
                    if (state) {
                        Main.notify("Enabling: " + name);
                        if (Main.shellDBusService.hasOwnProperty('EnableExtension')) {
                            Main.shellDBusService.EnableExtension(extension.uuid);
                        } else {
                            let settings = new Gio.Settings({schema: 'org.gnome.shell'});
                            let extensions = settings.get_strv(ENABLED_EXTENSIONS_KEY);

                            if (extensions.indexOf(extension.uuid) == -1)
                                extensions.push(extension.uuid);

                            settings.set_strv(ENABLED_EXTENSIONS_KEY, extensions);
                        }
                        _reorderIcons();
                    } else {
                        Main.notify("Disabling: " + name);
                        if (Main.shellDBusService.hasOwnProperty('DisableExtension')) {
                            Main.shellDBusService.DisableExtension(extension.uuid);
                            try {
                                let ext = (Main.ExtensionSystem.hasOwnProperty('extensionStateObjs'))
                                    ? Main.ExtensionSystem.extensionStateObjs[extension.uuid]
                                    : Main.ExtensionSystem.ExtensionUtils.extensions[extension.uuid].stateObj;
                                ext.disable();
                            } catch (err) {
                            }
                        } else {
                            Main.ExtensionSystem.disableExtension(extension.uuid);
                            let settings = new Gio.Settings({schema: 'org.gnome.shell'});
                            let extensions = settings.get_strv(ENABLED_EXTENSIONS_KEY);

                            while (extensions.indexOf(extension.uuid) != -1)
                                extensions.splice(extensions.indexOf(extension.uuid), 1);

                            settings.set_strv(ENABLED_EXTENSIONS_KEY, extensions);
                        }
                    }
                    _reorderIcons();
                })
            );
            this._extSubMenu.menu.addMenuItem(enableCombo);
            // Disconnect the signal stored in _activateId, as it closes the
            //  menu when we don't want to
            enableCombo.disconnect(enableCombo._activateId);
            // Without populating the _activateId with a valid signal
            //  connection, when the item is destroyed, it can cause
            //  an error within signals.js in gnome-shell v3.2.2.1
            enableCombo._activateId = enableCombo.connect('dummy-event', function() {});
        }
    },

    _overrideStatusIconDispatcher: function() {
        Main.statusIconDispatcher = new StatusIconDispatcher();
        Main.statusIconDispatcher.start(Main.messageTray.actor);
    }
}

function PromptUserRestart() {
    this._init.apply(this, arguments);
}

PromptUserRestart.prototype = {
    __proto__: ModalDialog.ModalDialog.prototype,
    
    _init: function(metadata, params) {

        ModalDialog.ModalDialog.prototype._init.call(this,
            { styleClass: 'end-session-dialog' });

        let dialogBox = new St.BoxLayout({ vertical: true });
        this.contentLayout.add(dialogBox, { y_align: St.Align.START });

        let subject = new St.Label({
            style_class: 'end-session-dialog-subject',
            text: "Restart the GNOME Shell"
        });
        dialogBox.add(subject, { y_fill:  false, y_align: St.Align.START });

        let description = new St.Label({
            style_class: 'end-session-dialog-description',
            text: "GNOME Shell must be restarted for this to take effect.\nDo you want to restart GNOME shell now?"
        });
        dialogBox.add(description, { y_fill:  true, y_align: St.Align.START });

        this.setButtons([{
            label: "Cancel",
            action: Lang.bind(this, function() {
                this.close();
                // The next time this setting is changed during the current
                //  lifetime of the extension, we won't need to restart since
                //  the restart from the original change was cancelled.
                _indecisionApplet._noRestartRequired = true;
            }),
            key: Clutter.Escape
        }, {
            label: "Restart",
            action: Lang.bind(this, function() {
                this.close();
                global.reexec_self();
            })
        }]);
    }
};

function SettingsManager() {
    this._init(_extensionPath);
}

SettingsManager.prototype = {
    _init: function(extensionPath) {
        this._config_file = Gio.file_new_for_path(extensionPath + '/settings.json');
        this._state_file = Gio.file_new_for_path(extensionPath + '/state.json');
    },

    save_config: function(config) {
        this._config_file.replace_contents(JSON.stringify(config, null, 4), null, false, 0, null);
    },

    save_state: function(state) {
        this._state_file.replace_contents(JSON.stringify(state, null, 4), null, false, 0, null);
    },

    load_config: function() {
        if(this._config_file.query_exists(null)) {
            [flag, data] = this._config_file.load_contents(null);

            if (flag) {
                return JSON.parse(data);
            }
        }
        return {};
    },

    load_state: function() {
        if(this._state_file.query_exists(null)) {
            [flag, data] = this._state_file.load_contents(null);

            if (flag) {
                return JSON.parse(data);
            }
        }
        return {};
    }
}

/*function StatusIconDispatcher() {
    this._init();
}

StatusIconDispatcher.prototype = {
    _init: StatusIconDispatcherOrig.StatusIconDispatcher.prototype._init,

    start: StatusIconDispatcherOrig.StatusIconDispatcher.prototype.start,

    _onTrayIconAdded: function(o, icon) {
        // Determine the role of the Tray Icon
        let wmClass = (icon.wm_class || 'unknown').toLowerCase();
        let role = STANDARD_TRAY_ICON_IMPLEMENTATIONS[wmClass];

        if (!role)
            role = wmClass;

        icon._role = role;

        // Create a new box to house the TrayIcon
        let box = new St.Bin({ style_class: 'panel-button',
                          reactive: true,
                          can_focus: true,
                          x_fill: false,
                          y_fill: false,
                          track_hover: true });

        if (icon.get_parent())
            icon.get_parent().remove_actor(icon);

        icon.height = PANEL_ICON_SIZE - 8;
        box.set_width(PANEL_ICON_SIZE + 4);

        box.add_actor(icon);
        box._delegate = box;

        // Insert the TrayIcon box into the main panel at the default
        //  status-order index.
        Main.panel._insertStatusItem(box, Main.panel._status_area_order.indexOf(role));

        // Make the box draggable
        _makeItemDraggable(box, true);

        // Check if this icon is hidden by the user; if so, hide it.
        if (_state.hasOwnProperty(role + "@shelltrayindicator"))
            if (_state[role + "@shelltrayindicator"].position < 0) {
                global.log("Not adding " + role + "@shelltrayindicator");
                box.hide();
                return;
            }

        // Rearange the icons in the panel, moving any items with
        //  user defined values to their specified locations.
        _reorderIcons();
    },

    _onTrayIconRemoved: function(o, icon) {
        let box = icon.get_parent();
        if (box && box._delegate instanceof St.Bin)
            box.destroy();
    }
};

Signals.addSignalMethods(StatusIconDispatcher.prototype);*/

function actionPanel(app) {
	this._init(app);
}

actionPanel.prototype = {

    _init : function() {
        let monitor = Main.layoutManager.primaryMonitor;
        let panelColor = Main.panel.actor.get_theme_node().get_color("background-color");

        this.actor = new St.BoxLayout({
            name: 'actionPanel',
            x: Math.floor(monitor.width / 2),
            y: Math.floor((monitor.height / 2) - 50),
            style_class: 'action-panel',
            reactive: true
        });

        this.icon = new St.Icon({
            icon_name: 'go-bottom-symbolic',
            icon_size: 20,
            style_class: 'action-panel-icon'
        });

        this.actor.add(this.icon);
        this.actor.add(
            new St.Label({
                text: 'Drag indicators here to hide them',
                style_class: 'action-panel-text'
            }), {
                expand: false, y_fill: false
            }
        );

        this.actor._delegate = this;

        Main.layoutManager.addChrome(this.actor);
        this.actor.set_x(Math.floor((monitor.width / 2) - (this.actor.get_width()/1.5)));
        this.hideActionPanel();

    },

    showActionPanel: function(disable, uninstall) {
        this.actor.show();
    },

    hideActionPanel: function() {
        this.actor.hide();
    },

}

function enable() {
    this._settings = new SettingsManager;
    this._settings._extensionPath = this._extensionPath;
    this._config = this._settings.load_config();
    this._state = this._settings.load_state();
    this._actionPanel = new actionPanel(this);
    this._indecisionApplet = new indecisionApplet();

    // Set the acceptDrop method on the panel
    Main.panel._rightBox.get_parent()._delegate.acceptDrop = function(source, actor, x, y, time) {
        return true;
    }

/*    if (this._config && this._config['trayIcons']) {
        // Override the statusIconDispatcher
        this._indecisionApplet._overrideStatusIconDispatcher();
    }
*/

    // Listen for changes to extension states
    this._extLoadedEventId = Main.ExtensionSystem._signals.connect('extension-loaded', Lang.bind(this, this._reorderIcons));

    if (this._config && this._config['trayIcons']) {
        new PromptUserRestart().open();
    } else {
        _reorderIcons();
    }
}

function disable() {
    delete this._config.restart;
    this._settings.save_config(this._config);
    //Main.statusIconDispatcher = StatusIconDispatcherOrig;
    Main.ExtensionSystem._signals.disconnect(this._extLoadedEventId);
    this._indecisionApplet.actor.get_parent().remove_actor(this._indecisionApplet.actor);
    delete Main.panel._rightBox.get_parent()._delegate.acceptDrop;
    new PromptUserRestart().open();
}
