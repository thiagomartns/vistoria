# Imagem da API em produção (infra/docker-compose.prod.yml), com o bundle das migrações (efbundle) ao lado.
# Uma imagem só: o serviço `migrate` do compose a usa com o efbundle de entrypoint, roda as migrações e sai; o `api`
# sobe depois dele. Context: a raiz do repositório (o .editorconfig de lá vale no build, como em dev).

FROM mcr.microsoft.com/dotnet/sdk:10.0.403-noble AS build
WORKDIR /src
COPY .editorconfig ./
WORKDIR /src/apps/api
COPY apps/api/global.json apps/api/Directory.Build.props apps/api/Directory.Packages.props ./
COPY apps/api/.config/dotnet-tools.json .config/
COPY apps/api/Vistoria.Api/Vistoria.Api.csproj Vistoria.Api/
RUN dotnet restore Vistoria.Api && dotnet tool restore
COPY apps/api/Vistoria.Api/ Vistoria.Api/
# O openapi.json é do repositório (gerado no build de dev e no CI); aqui não serve, e o build do bundle o geraria com o
# ambiente de Development do `dotnet ef`, que pede a connection string. O MSBuild lê a variável como propriedade.
ENV OpenApiGenerateDocuments=false
RUN dotnet publish Vistoria.Api -c Release --no-restore -o /out
RUN dotnet ef migrations bundle --project Vistoria.Api --configuration Release -o /out/efbundle

FROM mcr.microsoft.com/dotnet/aspnet:10.0.14-noble
# curl só para o healthcheck do compose (/health/ready); a imagem base não traz cliente HTTP.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out ./
# Usuário sem privilégio da própria imagem; a porta 8080 não exige root.
USER app
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Vistoria.Api.dll"]
