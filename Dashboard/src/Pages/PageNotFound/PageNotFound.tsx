// Tailwind
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import Email from "Common/Types/Email";
import NotFound from "CommonUI/src/Components/404";
import Page from "CommonUI/src/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";

const PageNotFound: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Page title={""} breadcrumbLinks={[]}>
      <NotFound
        homeRoute={new Route("/dashboard")}
        supportEmail={new Email("support@oneuptime.com")}
      />
    </Page>
  );
};

export default PageNotFound;
