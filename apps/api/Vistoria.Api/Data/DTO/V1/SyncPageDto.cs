namespace Vistoria.Api.Data.DTO.V1;

/// <summary>
/// Uma página do delta (backend.md, "Leitura por delta"): os registros vivos que mudaram depois do cursor, em
/// <c>items</c>, e os excluídos, só pelo id, em <c>deletedIds</c>, na ordem da versão. O cliente repete a chamada
/// com <c>nextCursor</c> enquanto <c>hasMore</c> for verdadeiro.
/// </summary>
public sealed record SyncPageDto<T>(
    IReadOnlyList<T> Items,
    IReadOnlyList<Guid> DeletedIds,
    string NextCursor,
    bool HasMore);
