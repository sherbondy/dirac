(ns dirac.background.tools
  (:require-macros [cljs.core.async.macros :refer [go go-loop]])
  (:require [cljs.core.async :refer [<! chan timeout]]
            [chromex.support :refer-macros [oget ocall oapply]]
            [chromex.logging :refer-macros [log info warn error group group-end]]
            [chromex.ext.windows :as windows]
            [chromex.ext.tabs :as tabs]
            [dirac.target.core :refer [resolve-backend-url]]
            [dirac.i18n :as i18n]
            [dirac.sugar :as sugar]
            [dirac.background.helpers :as helpers :refer [report-error-in-tab report-warning-in-tab]]
            [dirac.background.connections :as connections]
            [dirac.options.model :as options]
            [dirac.background.state :as state]))

(defn create-dirac-window! [panel?]
  (go
    (if-let [[window] (<! (windows/create #js {:url  (helpers/make-blank-page-url)                                            ; a blank page url is actually important here, url-less popups don't get assigned a tab-id
                                               :type (if panel? "popup" "normal")}))]
      (let [tabs (oget window "tabs")
            first-tab (aget tabs 0)]
        (sugar/get-tab-id first-tab)))))

(defn create-dirac-tab! []
  (go
    (if-let [[tab] (<! (tabs/create #js {:url (helpers/make-blank-page-url)}))]
      (sugar/get-tab-id tab))))

(defn get-dirac-open-as-setting []
  (let [setting (options/get-option :open-as)]
    (case setting
      "window" :window
      "tab" :tab
      :panel)))

(defn open-dirac-frontend! [open-as]
  (case open-as
    :tab (create-dirac-tab!)
    :panel (create-dirac-window! true)
    :window (create-dirac-window! false)))

(defn intercom-handler [message]
  (case (oget message "type")
    "marion-deliver-feedback" (state/post-to-marion! (oget message "envelope"))))

(defn connect-and-navigate-dirac-frontend! [dirac-tab-id backend-tab-id options]
  (let [connection-id (connections/register-connection! dirac-tab-id backend-tab-id)
        dirac-frontend-url (helpers/make-dirac-frontend-url connection-id options)]
    (go
      (<! (tabs/update dirac-tab-id #js {:url dirac-frontend-url}))
      (<! (timeout 500))                                                                                                      ; give the page some time load the document
      (helpers/install-intercom! connection-id intercom-handler))))

(defn create-dirac! [backend-tab-id options]
  (go
    (if-let [dirac-tab-id (<! (open-dirac-frontend! (:open-as options)))]
      (<! (connect-and-navigate-dirac-frontend! dirac-tab-id backend-tab-id options))
      (report-error-in-tab backend-tab-id (i18n/unable-to-create-dirac-tab)))))

(defn open-dirac! [tab options]
  (go
    (let [backend-tab-id (sugar/get-tab-id tab)
          tab-url (oget tab "url")
          target-url (options/get-option :target-url)]
      (assert backend-tab-id)
      (cond
        (not tab-url) (report-error-in-tab backend-tab-id (i18n/tab-cannot-be-debugged tab))
        (not target-url) (report-error-in-tab backend-tab-id (i18n/target-url-not-specified))
        :else
        (if-let [backend-url (<! (resolve-backend-url target-url tab-url))]
          (if (keyword-identical? backend-url :not-attachable)
            (report-warning-in-tab backend-tab-id (i18n/cannot-attach-dirac target-url tab-url))
            (<! (create-dirac! backend-tab-id (assoc options :backend-url backend-url))))
          (report-error-in-tab backend-tab-id (i18n/unable-to-resolve-backend-url target-url tab-url)))))))

(defn activate-dirac! [tab-id]
  (go
    (let [{:keys [dirac-tab-id]} (connections/find-backend-connection tab-id)
          _ (assert dirac-tab-id)
          dirac-window-id (<! (sugar/fetch-tab-window-id dirac-tab-id))]
      (if dirac-window-id
        (windows/update dirac-window-id #js {"focused"       true
                                             "drawAttention" true}))
      (tabs/update dirac-tab-id #js {"active" true}))))

(defonce flag-keys [:enable-repl
                    :enable-parinfer
                    :enable-friendly-locals
                    :enable-clustered-locals
                    :inline-custom-formatters])

(defn get-dirac-flags []
  (let [options (options/get-options)
        flags (map #(get options %) flag-keys)]
    (apply str (map #(if % "1" "0") flags))))

(defn activate-or-open-dirac! [tab & [options-overrides]]
  (let [tab-id (oget tab "id")]
    (if (connections/backend-connected? tab-id)
      (activate-dirac! tab-id)
      (let [options {:open-as (get-dirac-open-as-setting)
                     :flags   (get-dirac-flags)}]
        (open-dirac! tab (merge options options-overrides))))))                                                               ; options come from dirac extension settings, but we can override them

(defn open-dirac-in-active-tab! [& [options-overrides]]
  (go
    (let [[tabs] (<! (tabs/query #js {"lastFocusedWindow" true
                                      "active"            true}))]
      (if-let [tab (first tabs)]
        (<! (activate-or-open-dirac! tab options-overrides))
        (warn "no active tab?")))))

(defn close-tab-with-id! [tab-id-or-ids]
  (let [ids (if (coll? tab-id-or-ids) (into-array tab-id-or-ids) (int tab-id-or-ids))]
    (tabs/remove ids)))

(defn close-dirac-connection! [connection-id]
  (if-let [connection (state/get-connection connection-id)]
    (close-tab-with-id! (:dirac-tab-id connection))
    (warn "requested closing unknown dirac connection" connection-id)))