using Mapster;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Model;

namespace Vistoria.Api.Configurations;

/// <summary>
/// O <c>completedBy</c> do DTO sai das duas colunas da autoria, e só na concluída: o Mapster não monta um objeto a
/// partir de colunas soltas sozinho. O <c>completedSnapshot</c> separa a cópia da conclusão em imóvel e cliente
/// (ADR 0068). Achado pelo <c>config.Scan</c> do <see cref="MappingConfig"/>.
/// </summary>
public sealed class InspectionMapping : IRegister
{
    public void Register(TypeAdapterConfig config) =>
        config.NewConfig<Inspection, InspectionDto>()
            .Map(
                dto => dto.CompletedBy,
                inspection => inspection.CompletedById == null
                    ? null
                    : new InspectionAuthorDto(inspection.CompletedById.Value, inspection.CompletedByName ?? ""))
            .Map(dto => dto.CompletedSnapshot, inspection => SnapshotOf(inspection.CompletedSnapshot));

    private static InspectionSnapshotDto? SnapshotOf(CompletionSnapshot? snapshot) =>
        snapshot is null
            ? null
            : new InspectionSnapshotDto(
                new PropertySnapshotDto(
                    snapshot.Street,
                    snapshot.Number,
                    snapshot.Complement,
                    snapshot.District,
                    snapshot.City,
                    snapshot.State,
                    snapshot.ZipCode,
                    snapshot.PropertyType),
                new ClientSnapshotDto(snapshot.ClientName, snapshot.ClientDocument));
}
